package br.xfinder.series

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.mutableIntStateOf
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** Memória (só em RAM) de servidores que falharam recentemente, para evitá-los nas próximas tentativas. */
object Health {
    private val bad = HashMap<Long, Long>()
    private const val TTL = 20 * 60 * 1000L
    @Synchronized fun markBad(serverId: Long) { bad[serverId] = System.currentTimeMillis() }
    @Synchronized fun markGood(serverId: Long) { bad.remove(serverId) }
    @Synchronized fun isBad(serverId: Long): Boolean {
        val t = bad[serverId] ?: return false
        if (System.currentTimeMillis() - t > TTL) { bad.remove(serverId); return false }
        return true
    }
}

data class Progress(val pos: Long, val dur: Long, val watched: Boolean, val ts: Long) {
    val fraction: Float get() = if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f
}

data class ContinueItem(val series: Series, val season: Int, val num: Int, val ts: Long, val image: String? = null)

data class Profile(val id: Long, val name: String, val avatar: String) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("avatar", avatar)

    companion object {
        fun fromJson(o: JSONObject) = Profile(o.getLong("id"), o.optString("name"), o.optString("avatar"))
    }
}

/**
 * Dados do usuário (progresso, continuar assistindo, favoritos, ajustes).
 *
 * Cada perfil tem o próprio SharedPreferences, que funciona como cache local: a
 * interface lê e grava só nele. Toda gravação marca a chave como "suja"; uma
 * thread em segundo plano envia as chaves sujas ao servidor
 * (/api/profiles/{id}/data) e, ao entrar no perfil, baixa o que existe lá.
 * Offline, as alterações continuam marcadas e são enviadas na próxima chance.
 */
object Store {
    private lateinit var ctx: Context
    private lateinit var g: SharedPreferences   // globais: endereço do servidor, lista de perfis, dados antigos
    private lateinit var p: SharedPreferences   // do perfil atual
    private val lock = Any()
    private val exec = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "store-sync").apply { isDaemon = true } }
    private var scheduled: ScheduledFuture<*>? = null

    /** Incrementa a cada alteração para que as telas Compose releiam os dados. */
    val version = mutableIntStateOf(0)

    /** Perfil em uso (null até escolher na tela de perfis). */
    var currentProfile: Profile? = null
        private set

    /** Pode ser chamado por várias Activities: só a primeira chamada inicializa. */
    fun init(c: Context) {
        if (::g.isInitialized) return
        ctx = c.applicationContext
        g = ctx.getSharedPreferences("xfinder_series", Context.MODE_PRIVATE)
        p = g
    }

    private fun touch() { version.intValue++ }

    private fun prefsFor(id: Long) = ctx.getSharedPreferences("xfinder_profile_$id", Context.MODE_PRIVATE)

    var serverUrl: String?
        get() = g.getString("server_url", null)
        set(v) { g.edit().putString("server_url", v).apply(); touch() }

    // ---- perfis ----
    fun cachedProfiles(): List<Profile> = try {
        val a = JSONArray(g.getString("profiles_cache", "[]"))
        (0 until a.length()).map { Profile.fromJson(a.getJSONObject(it)) }
    } catch (e: Exception) { emptyList() }

    fun cacheProfiles(list: List<Profile>) {
        g.edit().putString("profiles_cache", JSONArray().also { a -> list.forEach { a.put(it.toJson()) } }.toString()).apply()
    }

    /** Escolhe o perfil: passa a usar o cache dele e sincroniza com o servidor. */
    fun enterProfile(pr: Profile) {
        currentProfile = pr
        p = prefsFor(pr.id)
        touch()
        val id = pr.id
        exec.execute { flush(id); pull(id) }
    }

    /** Apaga o cache local de um perfil excluído. */
    fun forgetProfile(id: Long) {
        if (currentProfile?.id == id) { currentProfile = null; p = g }
        ctx.deleteSharedPreferences("xfinder_profile_$id")
    }

    /** Há dados da versão antiga (sem perfis) para importar? */
    fun hasLegacy(): Boolean = g.all.keys.any { it.startsWith("p:") || it.startsWith("cw:") || it.startsWith("fav:") }

    /** Move favoritos, progresso e ajustes da versão sem perfis para o perfil [id]. */
    fun importLegacy(id: Long) {
        val prefs = prefsFor(id)
        synchronized(lock) {
            val ed = prefs.edit()
            val dirty = (prefs.getStringSet("_dirty", null) ?: emptySet()).toMutableSet()
            val gEd = g.edit()
            for ((k, v) in g.all) {
                val key: String
                val value: String
                when {
                    k.startsWith("p:") || k.startsWith("cw:") || k.startsWith("fav:") || k.startsWith("src:") || k == "recent2" -> {
                        key = k; value = v.toString()
                    }
                    k == "auto_next" || k == "skip_intro" || k == "resume" -> {
                        key = "set:$k"; value = if (v == true) "1" else "0"
                    }
                    else -> continue
                }
                ed.putString(key, value)
                dirty.add(key)
                gEd.remove(k)
            }
            ed.putStringSet("_dirty", dirty).apply()
            gEd.apply()
        }
        exec.execute { flush(id) }
    }

    // ---- gravação com sincronização ----
    private fun get(k: String): String? = p.getString(k, null)

    /** Grava (v != null) ou apaga (v == null) uma chave do perfil e agenda o envio ao servidor. */
    private fun put(k: String, v: String?) {
        synchronized(lock) {
            val dirty = (p.getStringSet("_dirty", null) ?: emptySet()).toMutableSet()
            val del = (p.getStringSet("_del", null) ?: emptySet()).toMutableSet()
            val ed = p.edit()
            if (v != null) { ed.putString(k, v); dirty.add(k); del.remove(k) }
            else { ed.remove(k); dirty.remove(k); del.add(k) }
            ed.putStringSet("_dirty", dirty).putStringSet("_del", del).apply()
        }
        scheduleFlush()
    }

    private fun scheduleFlush(delayMs: Long = 3000) {
        val id = currentProfile?.id ?: return
        synchronized(lock) {
            if (scheduled?.isDone == false) return
            scheduled = exec.schedule(Runnable {
                synchronized(lock) { scheduled = null }
                if (!flush(id)) scheduleFlush(30_000)
            }, delayMs, TimeUnit.MILLISECONDS)
        }
    }

    /** Envia as chaves sujas. Retorna false se o servidor não respondeu. */
    private fun flush(id: Long): Boolean {
        val prefs = prefsFor(id)
        val set = LinkedHashMap<String, String>()
        val del: List<String>
        synchronized(lock) {
            for (k in prefs.getStringSet("_dirty", null) ?: emptySet()) prefs.getString(k, null)?.let { set[k] = it }
            del = (prefs.getStringSet("_del", null) ?: emptySet()).toList()
        }
        if (set.isEmpty() && del.isEmpty()) return true
        try { Repo.pushProfileData(id, set, del) } catch (e: Exception) { return false }
        synchronized(lock) {
            val dirty = (prefs.getStringSet("_dirty", null) ?: emptySet()).toMutableSet()
            val dels = (prefs.getStringSet("_del", null) ?: emptySet()).toMutableSet()
            // só limpa o que não mudou durante o envio
            for ((k, v) in set) if (prefs.getString(k, null) == v) dirty.remove(k)
            for (k in del) if (!prefs.contains(k)) dels.remove(k)
            prefs.edit().putStringSet("_dirty", dirty).putStringSet("_del", dels).apply()
        }
        return true
    }

    /** Baixa os dados do perfil; o que está pendente de envio tem prioridade. */
    private fun pull(id: Long) {
        val data = try { Repo.profileData(id) } catch (e: Exception) { return }
        val prefs = prefsFor(id)
        synchronized(lock) {
            val dirty = prefs.getStringSet("_dirty", null) ?: emptySet()
            val del = prefs.getStringSet("_del", null) ?: emptySet()
            val ed = prefs.edit()
            for (k in prefs.all.keys) if (!k.startsWith("_") && k !in dirty && k !in data) ed.remove(k)
            for ((k, v) in data) if (k !in dirty && k !in del) ed.putString(k, v)
            ed.apply()
        }
        touch()
    }

    // ---- ajustes (por perfil) ----
    private fun bool(k: String, def: Boolean) = get("set:$k")?.let { it == "1" } ?: def

    var autoNext: Boolean
        get() = bool("auto_next", true)
        set(v) { put("set:auto_next", if (v) "1" else "0"); touch() }

    /** Botão "Pular abertura" (+1:30) no player de séries. */
    var skipIntro: Boolean
        get() = bool("skip_intro", true)
        set(v) { put("set:skip_intro", if (v) "1" else "0"); touch() }

    /** Retomar episódios/filmes de onde parou. */
    var resume: Boolean
        get() = bool("resume", true)
        set(v) { put("set:resume", if (v) "1" else "0"); touch() }

    // ---- progresso por episódio ----
    private fun pk(series: String, s: Int, e: Int) = "p:$series|$s|$e"

    fun progress(series: String, s: Int, e: Int): Progress? {
        val v = get(pk(series, s, e)) ?: return null
        val a = v.split(",")
        if (a.size < 4) return null
        return Progress(a[0].toLongOrNull() ?: 0, a[1].toLongOrNull() ?: 0, a[2] == "1", a[3].toLongOrNull() ?: 0)
    }

    private fun write(series: String, s: Int, e: Int, pr: Progress) {
        put(pk(series, s, e), "${pr.pos},${pr.dur},${if (pr.watched) 1 else 0},${pr.ts}")
    }

    /** Salva a posição; marca como visto ao passar de 92%. Retorna true se está visto. */
    fun saveProgress(series: String, s: Int, e: Int, pos: Long, dur: Long): Boolean {
        val prev = progress(series, s, e)
        val watched = (prev?.watched == true) || (dur > 0 && pos >= dur * 0.92)
        write(series, s, e, Progress(pos, dur, watched, System.currentTimeMillis()))
        touch()
        return watched
    }

    fun setWatched(series: String, s: Int, e: Int, watched: Boolean) {
        val prev = progress(series, s, e)
        write(series, s, e, Progress(if (watched) prev?.pos ?: 0 else 0, prev?.dur ?: 0, watched, System.currentTimeMillis()))
        touch()
    }

    fun setSeasonWatched(series: String, eps: List<Episode>, watched: Boolean) {
        eps.forEach { setWatched(series, it.season, it.num, watched) }
    }

    fun watchedCount(series: String): Int =
        p.all.keys.count { it.startsWith("p:$series|") && progress(series, it.split("|")[1].toInt(), it.split("|")[2].toInt())?.watched == true }

    // ---- continuar assistindo ----
    /** [image]: miniatura do episódio ou fundo da série; null mantém a anterior. */
    fun setContinue(series: Series, season: Int, num: Int, image: String? = null) {
        val img = image ?: continueFor(series.key)?.image
        val o = JSONObject().put("series", series.toJson()).put("season", season).put("num", num)
            .put("ts", System.currentTimeMillis()).put("image", img)
        put("cw:${series.key}", o.toString())
        touch()
    }

    fun clearContinue(seriesKey: String) {
        put("cw:$seriesKey", null)
        touch()
    }

    fun continueFor(seriesKey: String): ContinueItem? = get("cw:$seriesKey")?.let { parseCw(it) }

    fun continueList(): List<ContinueItem> =
        p.all.filterKeys { it.startsWith("cw:") }.values.mapNotNull { (it as? String)?.let(::parseCw) }
            .sortedByDescending { it.ts }

    private fun parseCw(s: String): ContinueItem? = try {
        val o = JSONObject(s)
        ContinueItem(Series.fromJson(o.getJSONObject("series")), o.getInt("season"), o.getInt("num"), o.optLong("ts"), o.optStringOrNull("image"))
    } catch (e: Exception) { null }

    // ---- favoritos ----
    fun isFavorite(key: String) = p.contains("fav:$key")

    fun toggleFavorite(series: Series) {
        if (isFavorite(series.key)) put("fav:${series.key}", null)
        else put("fav:${series.key}", series.toJson().toString())
        touch()
    }

    fun favorites(type: String): List<Series> =
        p.all.filterKeys { it.startsWith("fav:") }.values.mapNotNull {
            try { Series.fromJson(JSONObject(it as String)) } catch (e: Exception) { null }
        }.filter { it.type == type }.sortedBy { it.title.lowercase() }

    // ---- fonte preferida por série ----
    fun preferredSource(series: Series): Int {
        val id = get("src:${series.key}")?.toLongOrNull() ?: -1L
        return series.sources.indexOfFirst { it.serverId == id }.coerceAtLeast(0)
    }

    fun setPreferredSource(seriesKey: String, serverId: Long) {
        put("src:$seriesKey", serverId.toString())
    }

    // ---- buscas recentes ----
    private fun recentAll(): List<String> =
        (get("recent2") ?: "").split("\n").filter { it.isNotBlank() }

    /** Buscas recentes de um tipo (series | movie | live). */
    fun recentSearches(type: String): List<String> =
        recentAll().filter { it.startsWith("$type|") }.map { it.substringAfter("|") }

    /** Apaga o histórico de buscas de um tipo (series | movie | live). */
    fun clearRecentSearches(type: String) {
        val l = recentAll().filter { !it.startsWith("$type|") }
        put("recent2", l.joinToString("\n"))
        touch()
    }

    fun addRecentSearch(type: String, q: String) {
        val entry = "$type|${q.trim()}"
        val l = (listOf(entry) + recentAll().filter { !it.equals(entry, true) }).take(24)
        put("recent2", l.joinToString("\n"))
        touch()
    }
}
