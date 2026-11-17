package br.xfinder.series

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.mutableIntStateOf
import org.json.JSONObject

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

/** Persistência local: progresso, episódios vistos, continuar assistindo, favoritos e ajustes. */
object Store {
    private lateinit var p: SharedPreferences

    /** Incrementa a cada alteração para que as telas Compose releiam os dados. */
    val version = mutableIntStateOf(0)

    fun init(ctx: Context) {
        p = ctx.applicationContext.getSharedPreferences("xfinder_series", Context.MODE_PRIVATE)
    }

    private fun touch() { version.intValue++ }

    var serverUrl: String?
        get() = p.getString("server_url", null)
        set(v) { p.edit().putString("server_url", v).apply(); touch() }

    var autoNext: Boolean
        get() = p.getBoolean("auto_next", true)
        set(v) { p.edit().putBoolean("auto_next", v).apply(); touch() }

    /** Botão "Pular abertura" (+1:30) no player de séries. */
    var skipIntro: Boolean
        get() = p.getBoolean("skip_intro", true)
        set(v) { p.edit().putBoolean("skip_intro", v).apply(); touch() }

    /** Retomar episódios/filmes de onde parou. */
    var resume: Boolean
        get() = p.getBoolean("resume", true)
        set(v) { p.edit().putBoolean("resume", v).apply(); touch() }

    // ---- progresso por episódio ----
    private fun pk(series: String, s: Int, e: Int) = "p:$series|$s|$e"

    fun progress(series: String, s: Int, e: Int): Progress? {
        val v = p.getString(pk(series, s, e), null) ?: return null
        val a = v.split(",")
        if (a.size < 4) return null
        return Progress(a[0].toLongOrNull() ?: 0, a[1].toLongOrNull() ?: 0, a[2] == "1", a[3].toLongOrNull() ?: 0)
    }

    private fun write(series: String, s: Int, e: Int, pr: Progress) {
        p.edit().putString(pk(series, s, e), "${pr.pos},${pr.dur},${if (pr.watched) 1 else 0},${pr.ts}").apply()
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
        p.edit().putString("cw:${series.key}", o.toString()).apply()
        touch()
    }

    fun clearContinue(seriesKey: String) {
        p.edit().remove("cw:$seriesKey").apply()
        touch()
    }

    fun continueFor(seriesKey: String): ContinueItem? = p.getString("cw:$seriesKey", null)?.let { parseCw(it) }

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
        if (isFavorite(series.key)) p.edit().remove("fav:${series.key}").apply()
        else p.edit().putString("fav:${series.key}", series.toJson().toString()).apply()
        touch()
    }

    fun favorites(type: String): List<Series> =
        p.all.filterKeys { it.startsWith("fav:") }.values.mapNotNull {
            try { Series.fromJson(JSONObject(it as String)) } catch (e: Exception) { null }
        }.filter { it.type == type }.sortedBy { it.title.lowercase() }

    // ---- fonte preferida por série ----
    fun preferredSource(series: Series): Int {
        val id = p.getLong("src:${series.key}", -1L)
        return series.sources.indexOfFirst { it.serverId == id }.coerceAtLeast(0)
    }

    fun setPreferredSource(seriesKey: String, serverId: Long) {
        p.edit().putLong("src:$seriesKey", serverId).apply()
    }

    // ---- buscas recentes ----
    private fun recentAll(): List<String> =
        (p.getString("recent2", "") ?: "").split("\n").filter { it.isNotBlank() }

    /** Buscas recentes de um tipo (series | movie | live). */
    fun recentSearches(type: String): List<String> =
        recentAll().filter { it.startsWith("$type|") }.map { it.substringAfter("|") }

    /** Apaga o histórico de buscas de um tipo (series | movie | live). */
    fun clearRecentSearches(type: String) {
        val l = recentAll().filter { !it.startsWith("$type|") }
        p.edit().putString("recent2", l.joinToString("\n")).apply()
        touch()
    }

    fun addRecentSearch(type: String, q: String) {
        val entry = "$type|${q.trim()}"
        val l = (listOf(entry) + recentAll().filter { !it.equals(entry, true) }).take(24)
        p.edit().putString("recent2", l.joinToString("\n")).apply()
        touch()
    }
}

