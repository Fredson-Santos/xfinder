package br.xfinder.series

import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer

/** Uma ocorrência da série em um servidor Xtream. */
data class Source(
    val serverId: Long,
    val serverName: String,
    val serverType: String,
    val host: String?,
    val port: String?,
    val user: String?,
    val pass: String?,
    val seriesId: String?,
    val streamId: String? = null,
    val ext: String? = null,
    val rawUrl: String? = null,
) {
    /** Série: precisa de servidor Xtream + id da série. Filme/canal: URL direta ou stream_id Xtream. */
    fun usableFor(type: String): Boolean = when (type) {
        "series" -> serverType == "xtream" && !host.isNullOrBlank() && !seriesId.isNullOrBlank()
        else -> !rawUrl.isNullOrBlank() || (!host.isNullOrBlank() && !streamId.isNullOrBlank())
    }
    val usable: Boolean get() = usableFor("series")
    val cacheKey: String get() = "$serverId:$seriesId"

    private fun baseUrl(): String {
        val h = host!!.trim().trimEnd('/')
        val withScheme = if (h.startsWith("http")) h else "http://$h"
        val p = if (!port.isNullOrBlank() && !Regex(":\\d+$").containsMatchIn(withScheme)) ":$port" else ""
        return "$withScheme$p"
    }

    fun streamUrl(epId: String, ext: String): String = "${baseUrl()}/series/$user/$pass/$epId.$ext"

    /** URL de reprodução para filme ("movie") ou canal ao vivo ("live"). */
    fun playUrl(type: String): String {
        if (!rawUrl.isNullOrBlank()) return rawUrl
        val path = if (type == "live") "live" else "movie"
        val e = if (type == "live") "ts" else (ext ?: "mp4")
        return "${baseUrl()}/$path/$user/$pass/$streamId.$e"
    }

    fun toJson(): JSONObject = JSONObject()
        .put("serverId", serverId).put("serverName", serverName).put("serverType", serverType)
        .put("host", host).put("port", port).put("user", user).put("pass", pass).put("seriesId", seriesId)
        .put("streamId", streamId).put("ext", ext).put("rawUrl", rawUrl)

    companion object {
        fun fromJson(o: JSONObject) = Source(
            o.optLong("serverId"), o.optString("serverName"), o.optString("serverType"),
            o.optStringOrNull("host"), o.optStringOrNull("port"), o.optStringOrNull("user"),
            o.optStringOrNull("pass"), o.optStringOrNull("seriesId"),
            o.optStringOrNull("streamId"), o.optStringOrNull("ext"), o.optStringOrNull("rawUrl"),
        )
    }
}

/** Série agrupada por título normalizado, com todas as fontes (servidores) onde existe. */
data class Series(
    val key: String,
    val title: String,
    val year: Int?,
    val cover: String?,
    val sources: List<Source>,
    val type: String = "series",
) {
    fun toJson(): JSONObject = JSONObject()
        .put("type", type).put("key", key).put("title", title).put("year", year).put("cover", cover)
        .put("sources", JSONArray().also { a -> sources.forEach { a.put(it.toJson()) } })

    companion object {
        fun fromJson(o: JSONObject): Series {
            val arr = o.optJSONArray("sources") ?: JSONArray()
            return Series(
                o.getString("key"), o.optString("title"),
                if (o.has("year") && !o.isNull("year")) o.optInt("year") else null,
                o.optStringOrNull("cover"),
                (0 until arr.length()).map { Source.fromJson(arr.getJSONObject(it)) },
                o.optString("type").ifBlank { "series" },
            )
        }
    }
}

data class Episode(
    val id: String,
    val season: Int,
    val num: Int,
    val title: String,
    val ext: String,
    val plot: String?,
    val image: String?,
    val durationSecs: Int,
) {
    val label: String get() = "T$season E$num"
}

data class Detail(
    val plot: String?,
    val genre: String?,
    val rating: String?,
    val backdrop: String?,
    val cover: String?,
    val episodes: List<Episode>,
) {
    val seasons: List<Int> get() = episodes.map { it.season }.distinct().sorted()
    fun inSeason(s: Int) = episodes.filter { it.season == s }
    fun find(season: Int, num: Int) = episodes.firstOrNull { it.season == season && it.num == num }
    fun next(ep: Episode): Episode? {
        val i = episodes.indexOfFirst { it.season == ep.season && it.num == ep.num }
        return if (i >= 0) episodes.getOrNull(i + 1) else null
    }
}

fun JSONObject.optStringOrNull(name: String): String? {
    if (!has(name) || isNull(name)) return null
    val s = optString(name)
    return if (s.isBlank() || s == "null") null else s
}

private val tagRegex = Regex("\\b(legendado|dublado|dual|leg|dub|4k|fhd|uhd|hd|sd|multi|nacional)\\b")
private val bracketRegex = Regex("\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\}")
private val prefixRegex = Regex("^\\s*\\|?[a-z]{2,3}\\|?\\s*[-:|]\\s*")
private val diacritics = Regex("\\p{InCombiningDiacriticalMarks}+")

/** Normaliza o título para agrupar a mesma série de servidores diferentes. */
fun normalizeTitle(t: String): String {
    var s = Normalizer.normalize(t.lowercase(), Normalizer.Form.NFD).replace(diacritics, "")
    s = s.replace(bracketRegex, " ")
    s = s.replace(prefixRegex, "")
    s = s.replace(tagRegex, " ")
    return s.replace(Regex("[^a-z0-9]"), "")
}

