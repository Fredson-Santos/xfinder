package br.xfinder.series

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Acesso à API do XFinder. Todas as chamadas são bloqueantes (use em Dispatchers.IO). */
object Repo {
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .build()

    private val detailCache = HashMap<String, Detail>()

    private fun base(): String {
        val u = Store.serverUrl ?: throw IllegalStateException("Servidor não configurado")
        return u.trimEnd('/')
    }

    private fun getJson(url: okhttp3.HttpUrl): String {
        http.newCall(Request.Builder().url(url).header("User-Agent", "XFinderSeries/1.0").build()).execute().use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw RuntimeException("HTTP ${r.code}: ${body.take(120)}")
            return body
        }
    }

    /** Busca sob demanda no servidor (sem baixar catálogo). type: series | movie | live. */
    fun search(type: String, query: String): List<Series> {
        val url = "${base()}/api/search".toHttpUrl().newBuilder()
            .addQueryParameter("q", query)
            .addQueryParameter("type", type)
            .addQueryParameter("limit", "600")
            .build()
        val arr = JSONArray(getJson(url))
        val groups = LinkedHashMap<String, MutableList<JSONObject>>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val norm = normalizeTitle(o.optString("title"))
            if (norm.isEmpty()) continue
            val key = "$type:$norm"
            groups.getOrPut(key) { mutableListOf() }.add(o)
        }
        val out = ArrayList<Series>()
        for ((key, list) in groups) {
            val seen = HashSet<String>()
            val sources = ArrayList<Source>()
            for (o in list) {
                val servers = o.optJSONArray("servers") ?: continue
                for (j in 0 until servers.length()) {
                    val s = servers.getJSONObject(j)
                    val src = Source(
                        s.optLong("server_id"), s.optString("server_name"), s.optString("server_type"),
                        s.optStringOrNull("host"), s.optStringOrNull("port"),
                        s.optStringOrNull("username"), s.optStringOrNull("password"),
                        o.optStringOrNull("external_id"),
                        s.optStringOrNull("stream_id"), s.optStringOrNull("container_extension"), s.optStringOrNull("raw_url"),
                    )
                    val dedupe = if (type == "series") src.cacheKey else "${src.serverId}:${src.streamId ?: src.rawUrl}"
                    if (src.usableFor(type) && seen.add(dedupe)) sources.add(src)
                }
            }
            if (sources.isEmpty()) continue
            val title = list.map { it.optString("title") }.minByOrNull { it.length } ?: key.substringAfter(':')
            val year = list.firstNotNullOfOrNull { if (it.has("year") && !it.isNull("year")) it.optInt("year") else null }
            val cover = list.firstNotNullOfOrNull { it.optStringOrNull("cover_url") }
            out.add(Series(key, cleanTitle(title), year, cover, sources, type))
        }
        out.sortBy { it.title.lowercase() }
        return out
    }

    private fun cleanTitle(t: String) = t.replace(Regex("^\\s*\\|?[A-Za-z]{2,3}\\|?\\s*[-:|]\\s*"), "").trim()

    /** Temporadas e episódios de uma série em um servidor (get_series_info). */
    fun loadDetail(src: Source): Detail {
        detailCache[src.cacheKey]?.let { return it }
        val url = "${base()}/api/episodes".toHttpUrl().newBuilder()
            .addQueryParameter("serverType", "xtream")
            .addQueryParameter("host", src.host)
            .addQueryParameter("port", src.port ?: "")
            .addQueryParameter("username", src.user ?: "")
            .addQueryParameter("password", src.pass ?: "")
            .addQueryParameter("seriesId", src.seriesId)
            .build()
        val root = JSONObject(getJson(url))
        val info = root.optJSONObject("info")
        val eps = ArrayList<Episode>()
        val raw = root.opt("episodes")
        fun parse(o: JSONObject, seasonHint: Int?) {
            val ei = o.optJSONObject("info")
            val season = o.optString("season").toIntOrNull() ?: seasonHint ?: 1
            val num = o.optString("episode_num").toIntOrNull() ?: (eps.count { it.season == season } + 1)
            eps.add(
                Episode(
                    id = o.optString("id"),
                    season = season,
                    num = num,
                    title = o.optString("title").ifBlank { "Episódio $num" },
                    ext = o.optString("container_extension").ifBlank { "mp4" },
                    plot = ei?.optStringOrNull("plot"),
                    image = ei?.optStringOrNull("movie_image"),
                    durationSecs = ei?.optString("duration_secs")?.toIntOrNull() ?: 0,
                )
            )
        }
        when (raw) {
            is JSONObject -> raw.keys().forEach { k ->
                val a = raw.optJSONArray(k) ?: return@forEach
                for (i in 0 until a.length()) a.optJSONObject(i)?.let { parse(it, k.toIntOrNull()) }
            }
            is JSONArray -> for (i in 0 until raw.length()) {
                val v = raw.opt(i)
                if (v is JSONArray) for (j in 0 until v.length()) v.optJSONObject(j)?.let { parse(it, i + 1) }
                else if (v is JSONObject) parse(v, null)
            }
        }
        eps.sortWith(compareBy({ it.season }, { it.num }))
        val backdrop = info?.optJSONArray("backdrop_path")?.optString(0)?.takeIf { it.isNotBlank() }
        val d = Detail(
            plot = info?.optStringOrNull("plot") ?: info?.optStringOrNull("description"),
            genre = info?.optStringOrNull("genre"),
            rating = info?.optStringOrNull("rating"),
            backdrop = backdrop,
            cover = info?.optStringOrNull("cover"),
            episodes = eps,
        )
        if (eps.isNotEmpty()) detailCache[src.cacheKey] = d
        return d
    }

    /** Tenta as fontes em ordem (a preferida primeiro) até achar uma com episódios. */
    fun loadDetailAny(series: Series, preferred: Int): Pair<Int, Detail> {
        val n = series.sources.size
        // fonte preferida já em cache: resposta imediata
        detailCache[series.sources[preferred].cacheKey]?.let { return preferred to it }
        // consulta várias fontes em paralelo e usa a primeira que responder com episódios
        val base = (0 until n).map { (preferred + it) % n }
        val order = (base.filter { !Health.isBad(series.sources[it].serverId) } + base.filter { Health.isBad(series.sources[it].serverId) }).take(16)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(order.size.coerceAtMost(8))
        val cs = java.util.concurrent.ExecutorCompletionService<Pair<Int, Detail>>(pool)
        try {
            order.forEach { idx ->
                cs.submit { idx to loadDetail(series.sources[idx]).also { if (it.episodes.isEmpty()) throw RuntimeException("sem episódios") } }
            }
            var last: Exception? = null
            repeat(order.size) {
                try {
                    return cs.take().get()
                } catch (e: Exception) {
                    last = e
                }
            }
            throw RuntimeException("Nenhuma fonte disponível (${last?.cause?.message ?: last?.message})")
        } finally {
            pool.shutdownNow()
        }
    }

    // ---- perfis (dados do usuário guardados no servidor) ----
    private fun send(method: String, path: String, body: JSONObject? = null): String {
        val rb = body?.toString()?.toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url("${base()}$path").header("User-Agent", "XFinderSeries/1.0").method(method, rb).build()
        http.newCall(req).execute().use { r ->
            val text = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw RuntimeException("HTTP ${r.code}: ${text.take(120)}")
            return text
        }
    }

    fun profiles(): List<Profile> {
        val a = JSONArray(send("GET", "/api/profiles"))
        return (0 until a.length()).map { Profile.fromJson(a.getJSONObject(it)) }
    }

    fun createProfile(name: String, avatar: String): Profile =
        Profile.fromJson(JSONObject(send("POST", "/api/profiles", JSONObject().put("name", name).put("avatar", avatar))))

    fun updateProfile(id: Long, name: String, avatar: String) {
        send("PUT", "/api/profiles/$id", JSONObject().put("name", name).put("avatar", avatar))
    }

    fun deleteProfile(id: Long) { send("DELETE", "/api/profiles/$id") }

    fun profileData(id: Long): Map<String, String> {
        val o = JSONObject(send("GET", "/api/profiles/$id/data"))
        return o.keys().asSequence().associateWith { o.getString(it) }
    }

    fun pushProfileData(id: Long, set: Map<String, String>, del: Collection<String>) {
        send("POST", "/api/profiles/$id/data", JSONObject().put("set", JSONObject(set)).put("del", JSONArray(del)))
    }
}
