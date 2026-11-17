package br.xfinder.series

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.util.Locale
import kotlin.concurrent.thread

private const val SKIP_INTRO_MS = 90_000L
private const val NEXT_CARD_MS = 20_000L
private const val HIDE_AFTER_MS = 5_000L

private enum class Panel(val title: String) {
    Sources("Fontes disponíveis"), Audio("Áudio"), Subs("Legendas"), Speed("Velocidade"), Aspect("Tela")
}

/** Alvo de foco ao mostrar os controles. */
private enum class Target { Bar, Play, NextCard }

private val SPEEDS = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)
private val ASPECTS = listOf(
    AspectRatioFrameLayout.RESIZE_MODE_FIT to "Ajustar à tela",
    AspectRatioFrameLayout.RESIZE_MODE_ZOOM to "Preencher (corta as bordas)",
    AspectRatioFrameLayout.RESIZE_MODE_FILL to "Esticar",
)

@OptIn(UnstableApi::class)
class PlayerActivity : ComponentActivity() {
    private lateinit var player: ExoPlayer
    private lateinit var playerView: PlayerView
    private lateinit var series: Series
    private var episodes: List<Episode> = emptyList()
    private var detail: Detail? = null
    private var currentEp: Episode? = null
    private val handler = Handler(Looper.getMainLooper())
    private val failed = HashSet<Int>()
    private var started = false
    private var sameRetries = 0
    private var lastInteraction = 0L
    private val isSeries get() = series.type == "series"
    private val isLive get() = series.type == "live"

    // ─── estado observado pela interface (Compose) ───
    private var srcIdx by mutableIntStateOf(0)
    private var title by mutableStateOf("")
    private var subtitle by mutableStateOf("")
    private var flash by mutableStateOf<String?>(null)
    private var status by mutableStateOf<String?>("Carregando…")
    private var controls by mutableStateOf(false)
    private var target by mutableStateOf(Target.Bar)
    private var focusTick by mutableIntStateOf(0)
    private var panel by mutableStateOf<Panel?>(null)
    private var playing by mutableStateOf(false)
    private var pos by mutableLongStateOf(0L)
    private var dur by mutableLongStateOf(0L)
    private var buffered by mutableLongStateOf(0L)
    /** Posição escolhida com ←/→ ainda não aplicada (o seek só acontece ao parar). */
    private var scrub by mutableStateOf<Long?>(null)
    private var speed by mutableFloatStateOf(1f)
    private var resize by mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT)
    private var tracks by mutableStateOf(Tracks.EMPTY)
    private var hasPrev by mutableStateOf(false)
    private var hasNext by mutableStateOf(false)
    private var nextVisible by mutableStateOf(false)
    private var nextDismissed = false
    private var nextLabel by mutableStateOf("")
    private var exhausted by mutableStateOf(false)
    private var exhaustReason by mutableStateOf("")
    private var focusedLabel by mutableStateOf("")
    /** ok | failed (ausente = ainda não testada). */
    private val statuses = mutableStateMapOf<Int, String>()

    private val saver = object : Runnable {
        override fun run() { saveProgress(); handler.postDelayed(this, 5000) }
    }
    private val watchdog = Runnable {
        if (player.playbackState == Player.STATE_BUFFERING) handleFailure("tempo esgotado")
    }
    private val clearFlash = Runnable { flash = null }
    private val commitScrub = Runnable {
        scrub?.let { player.seekTo(it) }
        scrub = null
    }
    private val ticker = object : Runnable {
        override fun run() { tick(); handler.postDelayed(this, 500) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        series = Series.fromJson(JSONObject(intent.getStringExtra("series")!!))
        srcIdx = intent.getIntExtra("srcIdx", 0).coerceIn(0, (series.sources.size - 1).coerceAtLeast(0))
        val season = intent.getIntExtra("season", 1)
        val num = intent.getIntExtra("num", 1)

        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("IPTVSmartersPro/1.0.0")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000).setReadTimeoutMs(20000)
        player = ExoPlayer.Builder(this, DefaultRenderersFactory(this).setEnableDecoderFallback(true))
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .build()
        player.addListener(listener)

        playerView = PlayerView(this).apply {
            layoutParams = ViewGroup.LayoutParams(-1, -1)
            player = this@PlayerActivity.player
            useController = false
            keepScreenOn = true
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
            setShutterBackgroundColor(android.graphics.Color.BLACK)
            resizeMode = this@PlayerActivity.resize
        }

        title = series.title
        subtitle = if (isLive) "Ao vivo" else if (isSeries) "" else listOfNotNull("Filme", series.year?.toString()).joinToString(" · ")

        setContent { PlayerUi() }
        player.pauseAtEndOfMediaItems = !isLive
        // começa por uma fonte que não falhou recentemente
        if (Health.isBad(series.sources[srcIdx].serverId)) {
            series.sources.indices.firstOrNull { !Health.isBad(series.sources[it].serverId) && series.sources[it].usableFor(series.type) }
                ?.let { srcIdx = it }
        }
        handler.post(ticker)
        if (isSeries) load(season, num, null) else loadSimple(null)
    }

    // ═════════════════════════════ Interface ═════════════════════════════

    @Composable
    private fun PlayerUi() {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AndroidView({ playerView }, Modifier.fillMaxSize(), update = { it.resizeMode = resize })

            AnimatedVisibility(controls && !exhausted, enter = fadeIn(), exit = fadeOut()) { Controls() }

            status?.takeIf { !exhausted }?.let { StatusPill(it, Modifier.align(Alignment.Center)) }
            flash?.let {
                Text(
                    it, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 36.dp)
                        .clip(CircleShape).background(Color(0xCC1A1E25)).padding(horizontal = 20.dp, vertical = 10.dp),
                )
            }
            if (nextVisible && !exhausted) {
                NextCard(Modifier.align(Alignment.BottomEnd).padding(end = Edge, bottom = if (controls) 170.dp else 40.dp))
            }
            panel?.let { SidePanel(it) }
            if (exhausted) Failed()
        }
    }

    @Composable
    private fun StatusPill(text: String, modifier: Modifier) {
        Row(
            modifier.clip(RoundedCornerShape(16.dp)).background(Color(0xB3000000)).padding(horizontal = 22.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
            Spacer(Modifier.width(14.dp))
            Text(text, color = Color.White, fontSize = 15.sp, textAlign = TextAlign.Center)
        }
    }

    @Composable
    private fun Controls() {
        val barFr = remember { FocusRequester() }
        val playFr = remember { FocusRequester() }
        LaunchedEffect(focusTick) {
            delay(40)
            runCatching { (if (target == Target.Play || isLive) playFr else barFr).requestFocus() }
        }
        Box(Modifier.fillMaxSize()) {
            // topo: título
            Box(Modifier.fillMaxWidth().height(150.dp).background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent))))
            Row(Modifier.fillMaxWidth().padding(start = Edge, end = Edge, top = 30.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(title, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (subtitle.isNotEmpty()) Text(subtitle, color = Text2, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (series.sources.size > 1) {
                    Text(
                        series.sources[srcIdx].serverName, color = Text2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clip(CircleShape).background(Glass).padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }

            // base: barra + botões
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(240.dp).background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000)))))
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = Edge, end = Edge, bottom = 28.dp)) {
                if (isLive) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(9.dp).clip(CircleShape).background(Danger))
                        Spacer(Modifier.width(8.dp))
                        Text("AO VIVO", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
                    }
                } else {
                    Scrubber(barFr)
                    val shown = scrub ?: pos
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                        Text(fmt(shown), color = Text2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.weight(1f))
                        if (dur > 0) Text("-" + fmt(dur - shown), color = Text2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CtlButton(if (playing) Ic.Pause else Ic.Play, if (playing) "Pausar" else "Reproduzir", fr = playFr) { togglePlay() }
                    if (!isLive) {
                        CtlButton(Ic.Rewind, "Voltar 10 s") { seekBy(-10_000) }
                        CtlButton(Ic.Forward, "Avançar 10 s") { seekBy(10_000) }
                    }
                    if (isSeries && Store.skipIntro) CtlPill("Pular abertura", "+1:30") { skipIntro() }
                    if (isSeries) {
                        CtlButton(Ic.Prev, if (hasPrev) "Episódio anterior" else "Este é o primeiro episódio", enabled = hasPrev) { prev() }
                        CtlButton(Ic.Next, if (hasNext) "Próximo episódio" else "Este é o último episódio", enabled = hasNext) { advance() }
                    }
                    Spacer(Modifier.weight(1f))
                    Text(focusedLabel, color = Text2, fontSize = 13.sp, maxLines = 1, modifier = Modifier.padding(end = 6.dp))
                    val audio = tracksOf(C.TRACK_TYPE_AUDIO)
                    val text = tracksOf(C.TRACK_TYPE_TEXT)
                    if (audio.size > 1) CtlButton(Ic.Audio, "Áudio") { openPanel(Panel.Audio) }
                    if (text.isNotEmpty()) CtlButton(Ic.Subtitles, "Legendas") { openPanel(Panel.Subs) }
                    if (!isLive) CtlText(speedLabel(speed), "Velocidade") { openPanel(Panel.Speed) }
                    CtlButton(Ic.Aspect, "Tela: " + ASPECTS.first { it.first == resize }.second) { openPanel(Panel.Aspect) }
                    if (series.sources.size > 1) CtlButton(Ic.Server, "Fonte ${srcIdx + 1}/${series.sources.size}") { openPanel(Panel.Sources) }
                    CtlButton(Ic.External, "Abrir em outro player") { openExternal() }
                }
            }
        }
    }

    /** Barra de progresso focável: ←/→ escolhem a posição, OK pausa/continua. */
    @Composable
    private fun Scrubber(fr: FocusRequester) {
        var focused by remember { mutableStateOf(false) }
        val shown = scrub ?: pos
        val frac = if (dur > 0) shown.toFloat() / dur else 0f
        val buf = if (dur > 0) buffered.toFloat() / dur else 0f
        BoxWithConstraints(
            Modifier.fillMaxWidth().height(22.dp)
                .focusRequester(fr)
                .onFocusChanged { focused = it.isFocused; if (it.isFocused) focusedLabel = "" }
                .onKeyEvent { e ->
                    val k = e.nativeKeyEvent
                    if (k.action != KeyEvent.ACTION_DOWN) return@onKeyEvent k.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || k.keyCode == KeyEvent.KEYCODE_ENTER
                    when (k.keyCode) {
                        KeyEvent.KEYCODE_DPAD_LEFT -> { scrubStep(-1, k.repeatCount); true }
                        KeyEvent.KEYCODE_DPAD_RIGHT -> { scrubStep(1, k.repeatCount); true }
                        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { if (k.repeatCount == 0) togglePlay(); true }
                        else -> false
                    }
                }
                .focusable(),
            contentAlignment = Alignment.CenterStart,
        ) {
            val h = if (focused) 8.dp else 4.dp
            Box(Modifier.fillMaxWidth().height(h).clip(CircleShape).background(Color(0x40FFFFFF))) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(buf.coerceIn(0f, 1f)).background(Color(0x59FFFFFF)))
                Box(Modifier.fillMaxHeight().fillMaxWidth(frac.coerceIn(0f, 1f)).background(Color.White))
            }
            if (focused) {
                Box(Modifier.offset(x = maxWidth * frac.coerceIn(0f, 1f) - 8.dp).size(16.dp).clip(CircleShape).background(Color.White))
            }
        }
    }

    @Composable
    private fun CtlButton(icon: ImageVector, label: String, enabled: Boolean = true, fr: FocusRequester? = null, onClick: () -> Unit) {
        TvFocusable(
            Modifier.alpha(if (enabled) 1f else 0.4f), CircleShape, 1.1f, fr, { focusedLabel = label },
            onClick = { if (enabled) onClick() else showFlash(label) },
        ) { f ->
            Box(Modifier.size(44.dp).background(if (f) Color.White else Color.Transparent), contentAlignment = Alignment.Center) {
                Icon(icon, label, Modifier.size(24.dp), tint = if (f) Color.Black else Color.White)
            }
        }
    }

    @Composable
    private fun CtlText(text: String, label: String, onClick: () -> Unit) {
        TvFocusable(shape = CircleShape, focusedScale = 1.1f, onFocus = { focusedLabel = label }, onClick = onClick) { f ->
            Box(Modifier.height(44.dp).widthIn(min = 44.dp).background(if (f) Color.White else Color.Transparent).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                Text(text, color = if (f) Color.Black else Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        }
    }

    @Composable
    private fun CtlPill(text: String, small: String, onClick: () -> Unit) {
        TvFocusable(shape = CircleShape, focusedScale = 1.08f, onFocus = { focusedLabel = "Avança 1:30" }, onClick = onClick) { f ->
            Row(
                Modifier.height(40.dp).background(if (f) Color.White else Glass).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(text, color = if (f) Color.Black else Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.width(6.dp))
                Text(small, color = if (f) Color(0xFF555B63) else Text2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
        }
    }

    @Composable
    private fun NextCard(modifier: Modifier) {
        val fr = remember { FocusRequester() }
        LaunchedEffect(nextVisible, controls) {
            if (nextVisible && !controls) { delay(40); runCatching { fr.requestFocus() } }
        }
        val left = ((dur - pos) / 1000).coerceAtLeast(0)
        Column(
            modifier.width(340.dp).clip(RoundedCornerShape(18.dp)).background(Color(0xF01A1E25)).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                if (Store.autoNext) "PRÓXIMO EPISÓDIO EM ${left}s" else "PRÓXIMO EPISÓDIO",
                color = AccentText, fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 0.8.sp,
            )
            Text(nextLabel, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton("Assistir agora", Ic.Play, primary = true, focusRequester = fr) { advance() }
                PillButton("Cancelar") { dismissNext() }
            }
        }
    }

    @Composable
    private fun SidePanel(p: Panel) {
        val fr = remember(p) { FocusRequester() }
        LaunchedEffect(p) { delay(40); runCatching { fr.requestFocus() } }
        data class Opt(val label: String, val sub: String?, val selected: Boolean, val dot: Color?, val badge: String?, val run: () -> Unit)

        val opts: List<Opt> = when (p) {
            Panel.Sources -> series.sources.mapIndexed { i, s ->
                val st = statuses[i]
                Opt(
                    s.serverName, s.host, i == srcIdx,
                    when (st) { "ok" -> Green; "failed" -> Danger; else -> Color(0xFF5A616C) },
                    if (st == "failed" && i != srcIdx) "Falhou" else null,
                ) { switchSource(i) }
            }
            Panel.Audio -> tracksOf(C.TRACK_TYPE_AUDIO).map { t ->
                Opt(t.label, t.sub, t.selected, null, null) { selectTrack(t) }
            }
            Panel.Subs -> {
                val list = tracksOf(C.TRACK_TYPE_TEXT)
                val off = player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT) || list.none { it.selected }
                listOf(Opt("Desligadas", null, off, null, null) { disableSubs() }) +
                    list.map { t -> Opt(t.label, t.sub, t.selected && !off, null, null) { selectTrack(t) } }
            }
            Panel.Speed -> SPEEDS.map { s -> Opt(if (s == 1f) "Normal" else speedLabel(s), null, s == speed, null, null) { changeSpeed(s) } }
            Panel.Aspect -> ASPECTS.map { (mode, label) -> Opt(label, null, mode == resize, null, null) { resize = mode; panel = null } }
        }
        val focusIdx = opts.indexOfFirst { it.selected }.coerceAtLeast(0)

        Box(Modifier.fillMaxSize().background(Color(0x80000000))) {
            Column(
                Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(380.dp)
                    .background(Color(0xF7111318)).padding(horizontal = 22.dp, vertical = 32.dp),
            ) {
                Text(p.title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, bottom = 14.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp), contentPadding = PaddingValues(vertical = 6.dp)) {
                    itemsIndexed(opts) { i, o ->
                        MenuItem(
                            o.label, sub = o.sub, selected = o.selected, dot = o.dot, badge = o.badge,
                            focusRequester = if (i == focusIdx) fr else null, onClick = o.run,
                        )
                    }
                }
            }
        }
    }

    @Composable
    private fun Failed() {
        val fr = remember { FocusRequester() }
        LaunchedEffect(Unit) { delay(40); runCatching { fr.requestFocus() } }
        Box(Modifier.fillMaxSize().background(Color(0xF205060A)), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.widthIn(max = 560.dp)) {
                Icon(Ic.Warning, null, Modifier.size(44.dp), tint = Warn)
                Text("Nenhuma fonte respondeu", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text(
                    (if (series.sources.size > 1) "As ${series.sources.size} fontes foram testadas sem sucesso." else "O servidor não respondeu.") +
                        "\n($exhaustReason)",
                    color = Text2, fontSize = 14.sp, textAlign = TextAlign.Center, lineHeight = 21.sp,
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PillButton("Tentar novamente", Ic.Restart, primary = true, focusRequester = fr) { retryAll() }
                    PillButton("Outro player", Ic.External) { openExternal() }
                    PillButton("Fechar") { finish() }
                }
            }
        }
    }

    // ═════════════════════════════ Faixas / velocidade ═════════════════════════════

    private data class TrackOpt(val group: Tracks.Group, val index: Int, val label: String, val sub: String?, val selected: Boolean)

    private fun tracksOf(type: Int): List<TrackOpt> {
        val out = ArrayList<TrackOpt>()
        var n = 0
        for (g in tracks.groups) {
            if (g.type != type) continue
            for (i in 0 until g.length) {
                if (!g.isTrackSupported(i)) continue
                n++
                val f = g.getTrackFormat(i)
                out.add(TrackOpt(g, i, trackName(f, n), trackDetail(f, type), g.isTrackSelected(i)))
            }
        }
        return out
    }

    private fun trackName(f: Format, n: Int): String {
        val lang = f.language?.takeIf { it.isNotBlank() && it != "und" }?.let {
            Locale.forLanguageTag(it).getDisplayLanguage(Locale("pt", "BR")).replaceFirstChar { c -> c.uppercase() }
        }
        return f.label?.takeIf { it.isNotBlank() } ?: lang ?: "Faixa $n"
    }

    private fun trackDetail(f: Format, type: Int): String? = when (type) {
        C.TRACK_TYPE_AUDIO -> when (f.channelCount) {
            1 -> "Mono"; 2 -> "Estéreo"; 6 -> "5.1"; 8 -> "7.1"
            Format.NO_VALUE -> null
            else -> "${f.channelCount} canais"
        }
        else -> null
    }

    private fun selectTrack(t: TrackOpt) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(t.group.type, false)
            .setOverrideForType(TrackSelectionOverride(t.group.mediaTrackGroup, t.index))
            .build()
        panel = null
        showFlash(t.label)
    }

    private fun disableSubs() {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
        panel = null
        showFlash("Legendas desligadas")
    }

    private fun speedLabel(s: Float) = (if (s % 1f == 0f) s.toInt().toString() else s.toString()).replace('.', ',') + "x"

    private fun changeSpeed(s: Float) {
        speed = s
        player.setPlaybackSpeed(s)
        panel = null
    }

    // ═════════════════════════════ Ações ═════════════════════════════

    private fun showFlash(text: String, ms: Long = 1800) {
        flash = text
        handler.removeCallbacks(clearFlash); handler.postDelayed(clearFlash, ms)
    }

    private fun showControls(t: Target = Target.Bar) {
        lastInteraction = System.currentTimeMillis()
        target = t
        controls = true
        focusTick++
    }

    private fun openPanel(p: Panel) { panel = p; lastInteraction = System.currentTimeMillis() }

    private fun togglePlay() {
        if (player.isPlaying) player.pause()
        else {
            if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
            player.play()
        }
    }

    private fun seekBy(ms: Long) {
        val d = player.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
        player.seekTo((player.currentPosition + ms).coerceIn(0, d))
    }

    /** ←/→: acumula o salto (acelera segurando) e aplica 0,7 s depois de soltar. */
    private fun scrubStep(dir: Int, repeat: Int) {
        if (isLive) return
        val step = when { repeat > 30 -> 60_000L; repeat > 10 -> 30_000L; else -> 10_000L }
        val d = player.duration.takeIf { it > 0 } ?: Long.MAX_VALUE
        scrub = ((scrub ?: player.currentPosition) + dir * step).coerceIn(0, d)
        handler.removeCallbacks(commitScrub); handler.postDelayed(commitScrub, 700)
        lastInteraction = System.currentTimeMillis()
    }

    private fun skipIntro() {
        val d = player.duration
        val t = player.currentPosition + SKIP_INTRO_MS
        player.seekTo(if (d > 0) t.coerceAtMost(d - 1000) else t)
        showFlash("Avançou 1:30")
    }

    private fun prev() {
        if (!player.hasPreviousMediaItem()) return
        nextDismissed = false
        player.seekToPreviousMediaItem()
        player.playWhenReady = true
    }

    private fun advance() {
        nextVisible = false
        nextDismissed = false
        if (player.hasNextMediaItem()) {
            player.seekToNextMediaItem()
            player.playWhenReady = true
        }
    }

    private fun dismissNext() {
        nextDismissed = true
        nextVisible = false
    }

    private fun switchSource(i: Int) {
        panel = null
        if (i == srcIdx && statuses[i] == "ok") return
        failed.remove(i)
        statuses.remove(i)
        val p = player.currentPosition.coerceAtLeast(0)
        srcIdx = i
        Store.setPreferredSource(series.key, series.sources[i].serverId)
        if (isSeries) currentEp?.let { load(it.season, it.num, p) } else loadSimple(if (isLive) null else p)
    }

    private fun currentUrl(): String? {
        player.currentMediaItem?.localConfiguration?.uri?.toString()?.let { return it }
        val src = series.sources.getOrNull(srcIdx) ?: return null
        return if (isSeries) currentEp?.let { src.streamUrl(it.id, it.ext) } else src.playUrl(series.type)
    }

    private fun openExternal() {
        val url = currentUrl() ?: run { showFlash("Link do vídeo indisponível"); return }
        player.pause()
        try {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(url), "video/*"), "Abrir com"))
        } catch (e: ActivityNotFoundException) {
            showFlash("Nenhum outro player instalado")
        }
    }

    /** Atualiza tempo, card de próximo episódio e esconde os controles ociosos. */
    private fun tick() {
        pos = player.currentPosition.coerceAtLeast(0)
        dur = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0L
        buffered = player.bufferedPosition.coerceAtLeast(0)
        hasPrev = player.hasPreviousMediaItem()
        hasNext = player.hasNextMediaItem()
        val show = isSeries && started && hasNext && dur > 60_000 && dur - pos <= NEXT_CARD_MS && !nextDismissed && !exhausted
        if (show && !nextVisible) {
            episodes.getOrNull(player.nextMediaItemIndex)?.let { nextLabel = "${it.label} · ${cleanEpisodeTitle(it.title, series.title, it.num)}" }
        }
        nextVisible = show
        if (controls && panel == null && player.isPlaying && scrub == null &&
            System.currentTimeMillis() - lastInteraction > HIDE_AFTER_MS) controls = false
    }

    // ═════════════════════════════ Carregamento ═════════════════════════════

    private fun load(season: Int, num: Int, startPos: Long?) {
        status = "Carregando…"
        thread {
            try {
                val src = series.sources[srcIdx]
                val d = Repo.loadDetail(src)
                val ep = d.find(season, num) ?: throw RuntimeException("Episódio não encontrado nesta fonte")
                runOnUiThread { startPlayback(d, src, ep, startPos) }
            } catch (e: Exception) {
                runOnUiThread { failover(season, num, startPos ?: 0L, e.message) }
            }
        }
    }

    private fun resumeFrom(saved: Progress?): Long =
        if (!Store.resume) 0L
        else saved?.takeIf { !it.watched && it.pos > 10_000 }?.let { (it.pos - 3000).coerceAtLeast(0) } ?: 0L

    /** Filme ou canal ao vivo: um único item, sem lista de episódios. */
    private fun loadSimple(startPos: Long?) {
        val src = series.sources[srcIdx]
        val item = MediaItem.Builder()
            .setUri(src.playUrl(series.type))
            .setMediaMetadata(MediaMetadata.Builder().setTitle(series.title).build())
            .build()
        val resume = startPos ?: if (isLive) 0L else resumeFrom(Store.progress(series.key, 0, 0))
        if (failed.isEmpty()) status = "Carregando…"
        started = false
        player.setMediaItem(item, resume)
        player.prepare()
        player.playWhenReady = true
        Store.setPreferredSource(series.key, src.serverId)
        if (!isLive) Store.setContinue(series, 0, 0)
        if (startPos == null && resume > 0) showFlash("Retomando de ${fmt(resume)}", 2500)
        handler.removeCallbacks(saver); handler.postDelayed(saver, 5000)
    }

    private fun startPlayback(d: Detail, src: Source, ep: Episode, startPos: Long?) {
        detail = d
        episodes = d.episodes
        val items = episodes.map {
            MediaItem.Builder()
                .setUri(src.streamUrl(it.id, it.ext))
                .setMediaId("${it.season}x${it.num}")
                .setMediaMetadata(MediaMetadata.Builder().setTitle("${it.label} • ${it.title}").build())
                .build()
        }
        val idx = episodes.indexOfFirst { it.season == ep.season && it.num == ep.num }.coerceAtLeast(0)
        val resume = startPos ?: resumeFrom(Store.progress(series.key, ep.season, ep.num))
        currentEp = ep
        started = false
        player.setMediaItems(items, idx, resume)
        player.prepare()
        player.playWhenReady = true
        Store.setPreferredSource(series.key, src.serverId)
        Store.setContinue(series, ep.season, ep.num, ep.image ?: d.backdrop ?: d.cover)
        announce(ep)
        if (startPos == null && resume > 0) showFlash("Retomando de ${fmt(resume)}", 2500)
        handler.removeCallbacks(saver); handler.postDelayed(saver, 5000)
    }

    private fun announce(ep: Episode) {
        subtitle = "T${ep.season}:E${ep.num} · ${cleanEpisodeTitle(ep.title, series.title, ep.num)}"
    }

    /** Fontes ainda não tentadas, as sem falha recente primeiro. */
    private fun candidates(): List<Int> {
        val n = series.sources.size
        val l = (1..n).map { (srcIdx + it) % n }.filter { it !in failed && series.sources[it].usableFor(series.type) }
        return l.filter { !Health.isBad(series.sources[it].serverId) } + l.filter { Health.isBad(series.sources[it].serverId) }
    }

    /** Qualquer falha de reprodução (erro, tempo esgotado, travamento): marca a fonte e troca. */
    private fun handleFailure(reason: String?) {
        handler.removeCallbacks(watchdog)
        val p = player.currentPosition.coerceAtLeast(0)
        if (isSeries) {
            val ep = currentEp ?: return
            failover(ep.season, ep.num, p, reason)
        } else failoverSimple(p, reason)
    }

    private fun exhaustedMsg(reason: String?) {
        exhaustReason = reason ?: "erro desconhecido"
        exhausted = true
        controls = false
        panel = null
        status = null
    }

    private fun retryAll() {
        exhausted = false
        failed.clear()
        statuses.clear()
        val p = player.currentPosition.coerceAtLeast(0)
        if (isSeries) currentEp?.let { load(it.season, it.num, p) } ?: load(intent.getIntExtra("season", 1), intent.getIntExtra("num", 1), null)
        else loadSimple(if (isLive) null else p)
    }

    private fun markFailed(i: Int) {
        Health.markBad(series.sources[i].serverId)
        failed.add(i)
        statuses[i] = "failed"
    }

    /** Série: tenta o mesmo episódio em outro servidor, retomando de onde parou. */
    private fun failover(season: Int, num: Int, p: Long, reason: String?) {
        markFailed(srcIdx)
        val list = candidates()
        status = if (list.isEmpty()) "Procurando servidor…" else "“${series.sources[srcIdx].serverName}” falhou. Trocando de servidor… (${failed.size}/${series.sources.size})"
        thread {
            for (j in list) {
                val s = series.sources[j]
                try {
                    val d = Repo.loadDetail(s)
                    if (d.find(season, num) != null) {
                        runOnUiThread { srcIdx = j; load(season, num, p) }
                        return@thread
                    }
                    runOnUiThread { failed.add(j); statuses[j] = "failed" }
                } catch (e: Exception) { runOnUiThread { markFailed(j) } }
            }
            runOnUiThread { exhaustedMsg(reason) }
        }
    }

    /** Filme/canal: troca para a próxima fonte, retomando a posição (filme). */
    private fun failoverSimple(p: Long, reason: String?) {
        markFailed(srcIdx)
        val j = candidates().firstOrNull()
        if (j == null) { exhaustedMsg(reason); return }
        status = "Servidor falhou. Tentando “${series.sources[j].serverName}”… (${failed.size + 1}/${series.sources.size})"
        srcIdx = j
        loadSimple(if (isLive) null else p)
    }

    // ═════════════════════════════ Eventos do player ═════════════════════════════

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            if (state == Player.STATE_READY) {
                handler.removeCallbacks(watchdog)
                val first = !started
                status = null; started = true; failed.clear(); sameRetries = 0; exhausted = false
                statuses[srcIdx] = "ok"
                Health.markGood(series.sources[srcIdx].serverId)
                if (first && !controls) showControls(Target.Bar)
            }
            if (state == Player.STATE_BUFFERING) {
                if (!started && failed.isEmpty()) status = "Carregando…"
                if (started) status = "Carregando…"
                // sem avanço por muito tempo (servidor travado, sem erro): troca de servidor
                handler.removeCallbacks(watchdog)
                handler.postDelayed(watchdog, if (started) 30_000L else 25_000L)
            }
            if (state == Player.STATE_ENDED || state == Player.STATE_IDLE) handler.removeCallbacks(watchdog)
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            playing = isPlaying
            if (!isPlaying) saveProgress()
        }

        override fun onTracksChanged(t: Tracks) { tracks = t }

        override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
            val id = item?.mediaId ?: return
            val ep = episodes.firstOrNull { "${it.season}x${it.num}" == id } ?: return
            if (ep == currentEp) return
            currentEp = ep
            nextDismissed = false
            nextVisible = false
            Store.setContinue(series, ep.season, ep.num, ep.image ?: detail?.backdrop)
            announce(ep)
            showControls(Target.Bar)
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) {
                val r = resumeFrom(Store.progress(series.key, ep.season, ep.num))
                if (r > 0) { player.seekTo(r); showFlash("Retomando de ${fmt(r)}", 2500) }
            }
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) onEpisodeEnded()
        }

        override fun onPlayerError(error: PlaybackException) {
            // queda no meio da reprodução: reconecta uma vez no mesmo servidor antes de trocar
            if (started && sameRetries < 1) {
                sameRetries++
                status = "Reconectando…"
                player.prepare()
                return
            }
            handleFailure(error.errorCodeName)
        }
    }

    private fun onEpisodeEnded() {
        if (!isSeries) {
            if (isLive) return
            Store.setWatched(series.key, 0, 0, true)
            Store.clearContinue(series.key)
            finish()
            return
        }
        val ep = currentEp ?: return
        val d = player.duration.coerceAtLeast(0)
        Store.saveProgress(series.key, ep.season, ep.num, d, d)
        Store.setWatched(series.key, ep.season, ep.num, true)
        val next = episodes.getOrNull(episodes.indexOfFirst { it.season == ep.season && it.num == ep.num } + 1)
        if (next == null) {
            Store.clearContinue(series.key)
            showFlash("Fim da série", 4000)
            showControls(Target.Play)
            return
        }
        Store.setContinue(series, next.season, next.num, next.image)
        if (Store.autoNext && !nextDismissed) advance()
        else {
            showFlash("Episódio concluído", 3000)
            showControls(Target.Play)
        }
    }

    private fun saveProgress() {
        if (!started) return
        if (!isSeries) {
            if (isLive) return
            val d = player.duration
            if (d <= 0) return
            val w = Store.saveProgress(series.key, 0, 0, player.currentPosition.coerceAtLeast(0), d)
            if (w) Store.clearContinue(series.key) else Store.setContinue(series, 0, 0)
            return
        }
        val ep = currentEp ?: return
        val d = player.duration
        if (d <= 0) return
        val p = player.currentPosition.coerceAtLeast(0)
        val watched = Store.saveProgress(series.key, ep.season, ep.num, p, d)
        if (watched) {
            val next = episodes.getOrNull(episodes.indexOfFirst { it.season == ep.season && it.num == ep.num } + 1)
            if (next != null) Store.setContinue(series, next.season, next.num, next.image) else Store.clearContinue(series.key)
        } else {
            Store.setContinue(series, ep.season, ep.num)
        }
    }

    // ═════════════════════════════ Controle remoto ═════════════════════════════

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        val down = e.action == KeyEvent.ACTION_DOWN
        lastInteraction = System.currentTimeMillis()

        // teclas de mídia funcionam sempre
        when (e.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> { if (down && e.repeatCount == 0) { togglePlay(); showControls(Target.Bar) }; return true }
            KeyEvent.KEYCODE_MEDIA_PLAY -> { if (down) player.play(); return true }
            KeyEvent.KEYCODE_MEDIA_PAUSE -> { if (down) { player.pause(); showControls(Target.Bar) }; return true }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { if (down && !isLive) { scrubStep(1, e.repeatCount + 11); showControls(Target.Bar) }; return true }
            KeyEvent.KEYCODE_MEDIA_REWIND -> { if (down && !isLive) { scrubStep(-1, e.repeatCount + 11); showControls(Target.Bar) }; return true }
            KeyEvent.KEYCODE_MEDIA_NEXT -> { if (down && isSeries) advance(); return true }
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> { if (down && isSeries) prev(); return true }
        }

        if (e.keyCode == KeyEvent.KEYCODE_BACK) {
            if (down && e.repeatCount == 0) when {
                exhausted -> finish()
                panel != null -> { panel = null; focusTick++ }
                scrub != null -> { handler.removeCallbacks(commitScrub); scrub = null }
                controls -> controls = false
                nextVisible -> dismissNext()
                else -> finish()
            }
            return true
        }

        // telas com botões próprios: o foco do Compose cuida da navegação
        if (exhausted || panel != null || controls || nextVisible) {
            if (controls) lastInteraction = System.currentTimeMillis()
            return super.dispatchKeyEvent(e)
        }

        // controles escondidos: atalhos no estilo Apple TV
        if (!down) return true
        when (e.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> { if (!isLive) scrubStep(-1, e.repeatCount); showControls(Target.Bar) }
            KeyEvent.KEYCODE_DPAD_RIGHT -> { if (!isLive) scrubStep(1, e.repeatCount); showControls(Target.Bar) }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER ->
                if (e.repeatCount == 0) { togglePlay(); showControls(Target.Bar) }
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_INFO ->
                showControls(if (e.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) Target.Play else Target.Bar)
            else -> return super.dispatchKeyEvent(e)
        }
        return true
    }

    override fun onStop() {
        super.onStop()
        saveProgress()
        player.pause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        saveProgress()
        player.release()
        super.onDestroy()
    }
}
