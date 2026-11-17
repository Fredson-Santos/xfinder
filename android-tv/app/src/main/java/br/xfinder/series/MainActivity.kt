package br.xfinder.series

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * Pilha de telas. Cada entrada guarda o próprio estado (busca, rolagem, item
 * focado) para que VOLTAR devolva a tela exatamente como estava.
 */
sealed interface Screen {
    class Home : Screen {
        val list = LazyListState()
        val rows = HashMap<String, LazyListState>()
        var lastFocus: String? = null
    }

    class Search(type: String, query: String = "") : Screen {
        var type by mutableStateOf(type)
        var query by mutableStateOf(query)
        var results by mutableStateOf<List<Series>>(emptyList())
        var loading by mutableStateOf(false)
        var error by mutableStateOf<String?>(null)
        /** "tipo|consulta" já buscados (não refaz ao voltar para a tela). */
        var searched: String? = null
        /** Busca disparada por um botão de "Buscas recentes" (ver finishRecentPick). */
        var fromRecent by mutableStateOf(false)
        val grid = LazyGridState()
        var lastFocus by mutableStateOf<String?>(null)
    }

    data object Settings : Screen
    class Detail(val series: Series) : Screen
}

fun typeLabel(type: String) = when (type) {
    "movie" -> "filmes"
    "live" -> "canais"
    else -> "séries"
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Accent, background = Bg, surface = Surface)) {
                Box(Modifier.fillMaxSize().background(Bg)) { App() }
            }
        }
    }
}

@Composable
fun App() {
    val stack = remember {
        mutableStateListOf<Screen>(if (Store.serverUrl == null) Screen.Settings else Screen.Home())
    }
    BackHandler(enabled = stack.size > 1) { stack.removeAt(stack.lastIndex) }
    val s = stack.last()
    key(s) {
        when (s) {
            is Screen.Home -> HomeScreen(
                s,
                onSearch = { type -> stack.add(Screen.Search(type)) },
                onSettings = { stack.add(Screen.Settings) },
                onOpen = { stack.add(Screen.Detail(it)) },
            )
            is Screen.Search -> SearchScreen(s, onOpen = { stack.add(Screen.Detail(it)) })
            Screen.Settings -> SettingsScreen(onDone = {
                if (stack.size > 1) stack.removeAt(stack.lastIndex) else stack[0] = Screen.Home()
            })
            is Screen.Detail -> if (s.series.type == "series") SeriesScreen(s.series) else MediaScreen(s.series)
        }
    }
}

/** Pede foco depois que a tela compôs (e tenta de novo se ainda não estiver pronta). */
@Composable
fun InitialFocus(fr: FocusRequester, vararg keys: Any?) {
    LaunchedEffect(*keys) {
        repeat(5) {
            delay(60)
            if (runCatching { fr.requestFocus() }.isSuccess) return@LaunchedEffect
        }
    }
}

// ───────────────────────────── Início ─────────────────────────────

@Composable
fun HomeScreen(state: Screen.Home, onSearch: (String) -> Unit, onSettings: () -> Unit, onOpen: (Series) -> Unit) {
    Store.version.intValue
    val cont = Store.continueList()
    val favs = listOf(
        "fav-series" to ("Séries favoritas" to Store.favorites("series")),
        "fav-movie" to ("Filmes favoritos" to Store.favorites("movie")),
        "fav-live" to ("Canais favoritos" to Store.favorites("live")),
    ).filter { it.second.second.isNotEmpty() }
    val empty = cont.isEmpty() && favs.isEmpty()

    // Foco: volta ao último cartão escolhido; senão o 1º de "Continuar"; senão "Séries"
    val firstKey = state.lastFocus ?: cont.firstOrNull()?.let { "cw:${it.series.key}" } ?: "nav:series"
    val restore = remember { FocusRequester() }
    InitialFocus(restore, Unit)
    fun fr(k: String) = if (k == firstKey) restore else null

    LazyColumn(Modifier.fillMaxSize(), state = state.list, contentPadding = PaddingValues(bottom = 48.dp)) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(start = Edge, end = Edge, top = 26.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("XFinder", color = TextPri, fontSize = 22.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    PillButton("Séries", focusRequester = fr("nav:series"), onFocus = { state.lastFocus = "nav:series" }) { onSearch("series") }
                    PillButton("Filmes", focusRequester = fr("nav:movie"), onFocus = { state.lastFocus = "nav:movie" }) { onSearch("movie") }
                    PillButton("Canais", focusRequester = fr("nav:live"), onFocus = { state.lastFocus = "nav:live" }) { onSearch("live") }
                    PillButton(null, Ic.Search, focusRequester = fr("nav:search"), onFocus = { state.lastFocus = "nav:search" }) { onSearch("series") }
                    PillButton(null, Ic.Settings, focusRequester = fr("nav:settings"), onFocus = { state.lastFocus = "nav:settings" }, onClick = onSettings)
                }
            }
        }

        if (cont.isNotEmpty()) item { Column {
            ShelfTitle("Continuar assistindo")
            LazyRow(
                state = state.rows.getOrPut("cw") { LazyListState() },
                contentPadding = PaddingValues(horizontal = Edge, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                items(cont, key = { it.series.key }) { c ->
                    val k = "cw:${c.series.key}"
                    val isSeries = c.series.type == "series"
                    val pr = if (isSeries) Store.progress(c.series.key, c.season, c.num) else Store.progress(c.series.key, 0, 0)
                    val left = pr?.takeIf { !it.watched && it.dur > 0 && it.pos > 10_000 }?.let { " · faltam ${humanDuration(it.dur - it.pos)}" } ?: ""
                    val sub = when (c.series.type) {
                        "series" -> "T${c.season}:E${c.num}$left"
                        "live" -> "Ao vivo"
                        else -> "Filme$left"
                    }
                    WideCard(
                        c.series.title, sub, c.image ?: c.series.cover,
                        progress = if (pr == null || pr.watched) 0f else pr.fraction,
                        modifier = Modifier.width(264.dp), focusRequester = fr(k),
                        onFocus = { state.lastFocus = k },
                    ) { onOpen(c.series) }
                }
            }
        } }

        for ((id, pair) in favs) {
            val (title, list) = pair
            item(key = id) { Column {
                ShelfTitle(title)
                LazyRow(
                    state = state.rows.getOrPut(id) { LazyListState() },
                    contentPadding = PaddingValues(horizontal = Edge, vertical = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    items(list, key = { it.key }) { s ->
                        val k = "$id:${s.key}"
                        val sub = when (s.type) {
                            "series" -> Store.watchedCount(s.key).takeIf { it > 0 }?.let { "$it episódios vistos" }
                            "movie" -> if (Store.progress(s.key, 0, 0)?.watched == true) "Assistido" else s.year?.toString()
                            else -> "Ao vivo"
                        }
                        PosterCard(
                            s.title, s.cover, sub, Modifier.width(if (s.type == "live") 150.dp else 132.dp),
                            live = s.type == "live", focusRequester = fr(k), onFocus = { state.lastFocus = k },
                        ) { onOpen(s) }
                    }
                }
            } }
        }

        if (empty) item {
            Column(Modifier.padding(start = Edge, end = Edge, top = 90.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Bem-vindo ao XFinder", color = TextPri, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Escolha Séries, Filmes ou Canais acima e busque pelo nome.\nO que você assistir e favoritar aparece aqui.",
                    color = Dim, fontSize = 16.sp, lineHeight = 24.sp,
                )
            }
        }
    }
}

// ───────────────────────────── Busca ─────────────────────────────

@Composable
fun SearchScreen(state: Screen.Search, onOpen: (Series) -> Unit) {
    Store.version.intValue
    var trigger by remember { mutableIntStateOf(0) }
    val fieldFr = remember { FocusRequester() }
    val restore = remember { FocusRequester() }
    val returning = state.lastFocus != null && state.results.any { it.key == state.lastFocus }
    InitialFocus(if (returning) restore else fieldFr, Unit)

    /**
     * Busca escolhida em "Buscas recentes": o foco vai para o 1º resultado e só
     * então a fileira de recentes some. Se ela sumisse antes, o foco cairia no
     * campo de texto no mesmo quadro em que o texto muda, e o Compose quebra.
     */
    suspend fun finishRecentPick() {
        if (!state.fromRecent) return
        state.results.firstOrNull()?.let { first ->
            state.lastFocus = first.key
            delay(80)
            runCatching { restore.requestFocus() }
            delay(50)
        }
        state.fromRecent = false
    }

    LaunchedEffect(state.query, state.type, trigger) {
        val q = state.query.trim()
        val tag = "${state.type}|$q|$trigger"
        if (tag == state.searched) { finishRecentPick(); return@LaunchedEffect }
        state.error = null
        if (q.length < 2) { state.results = emptyList(); state.searched = tag; return@LaunchedEffect }
        delay(450)
        state.loading = true
        try {
            state.results = withContext(Dispatchers.IO) { Repo.search(state.type, q) }
            state.searched = tag
            state.lastFocus = null
            state.grid.scrollToItem(0)
            // histórico só ao abrir um resultado ou confirmar no teclado (não a cada pausa na digitação)
        } catch (e: Exception) {
            state.error = "Falha na busca: ${e.message}"
        } finally { state.loading = false }
        finishRecentPick()
    }

    val live = state.type == "live"
    Column(Modifier.fillMaxSize().padding(top = 26.dp)) {
        Row(Modifier.padding(horizontal = Edge), verticalAlignment = Alignment.CenterVertically) {
            GlassField(
                state.query, { state.query = it }, "Buscar ${typeLabel(state.type)}…",
                Modifier.weight(1f), fieldFr, Ic.Search, ImeAction.Search, onAction = { trigger++; if (state.query.trim().length >= 2) Store.addRecentSearch(state.type, state.query.trim()) },
            )
            Spacer(Modifier.width(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((t, label) in listOf("series" to "Séries", "movie" to "Filmes", "live" to "Canais")) {
                    TypeChip(label, state.type == t) { if (state.type != t) { state.type = t; state.results = emptyList() } }
                }
            }
        }

        val q = state.query.trim()
        val line = when {
            state.loading -> "Buscando…"
            state.error != null -> state.error
            q.length >= 2 && state.results.isEmpty() && state.searched?.startsWith("${state.type}|$q|") == true -> "Nada encontrado para “$q”."
            state.results.isNotEmpty() -> "${state.results.size} ${typeLabel(state.type)}"
            else -> null
        }
        if (line != null) {
            Row(Modifier.padding(start = Edge, top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                if (state.loading) {
                    CircularProgressIndicator(Modifier.size(14.dp), color = Dim, strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                }
                Text(line, color = if (state.error != null) Danger else Dim, fontSize = 13.sp)
            }
        }

        val recents = Store.recentSearches(state.type)
        if ((q.isEmpty() || state.fromRecent) && recents.isNotEmpty()) {
            Text("Buscas recentes", color = TextPri, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = Edge, top = 26.dp))
            LazyRow(contentPadding = PaddingValues(horizontal = Edge, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(recents.take(10)) { r -> PillButton(r, Ic.Undo) { state.fromRecent = true; state.query = r } }
                item {
                    // o foco vai para o campo antes de a fileira sumir (senão fica perdido)
                    PillButton("Limpar", Ic.Close) {
                        runCatching { fieldFr.requestFocus() }
                        Store.clearRecentSearches(state.type)
                    }
                }
            }
        }

        LazyVerticalGrid(
            columns = GridCells.Fixed(if (live) 7 else 6),
            state = state.grid,
            contentPadding = PaddingValues(start = Edge, end = Edge, top = 18.dp, bottom = 40.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(state.results, key = { it.key }) { s ->
                val sub = listOfNotNull(
                    s.year?.toString(),
                    "${s.sources.size} ${if (s.sources.size == 1) "fonte" else "fontes"}",
                ).joinToString(" · ")
                PosterCard(
                    s.title, s.cover, sub, live = live,
                    focusRequester = if (s.key == state.lastFocus) restore else null,
                    onFocus = { state.lastFocus = s.key },
                ) { Store.addRecentSearch(state.type, state.query.trim()); onOpen(s) }
            }
        }
    }
}

@Composable
private fun TypeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    TvFocusable(shape = CircleShape, focusedScale = 1.07f, onClick = onClick) { f ->
        Text(
            label,
            color = when { f -> Color.Black; selected -> Color.Black; else -> Text2 },
            fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .background(when { f -> Color.White; selected -> TextPri; else -> Glass })
                .padding(horizontal = 18.dp, vertical = 12.dp),
        )
    }
}

// ───────────────────────────── Ajustes ─────────────────────────────

@Composable
fun SettingsScreen(onDone: () -> Unit) {
    Store.version.intValue
    var url by remember { mutableStateOf(Store.serverUrl ?: "http://192.168.15.158:2332") }
    val focus = remember { FocusRequester() }
    InitialFocus(focus, Unit)

    fun save() {
        var u = url.trim()
        if (u.isEmpty()) return
        if (!u.startsWith("http")) u = "http://$u"
        Store.serverUrl = u
        onDone()
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = Edge, vertical = 36.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Text("Ajustes", color = TextPri, fontSize = 32.sp, fontWeight = FontWeight.Bold) }
        item {
            Text("Servidor XFinder", color = Dim, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
            GlassField(url, { url = it }, "http://192.168.0.10:2332", Modifier.width(520.dp), focus, Ic.Server, ImeAction.Done, onAction = { save() })
        }
        item { Text("Reprodução", color = Dim, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp)) }
        item { ToggleRow("Próximo episódio automático", "Começa o próximo episódio ao terminar o atual.", Store.autoNext) { Store.autoNext = !Store.autoNext } }
        item { ToggleRow("Botão “Pular abertura”", "Mostra no player de séries o botão que avança 1:30.", Store.skipIntro) { Store.skipIntro = !Store.skipIntro } }
        item { ToggleRow("Retomar de onde parou", "Filmes e episódios continuam do ponto em que você parou.", Store.resume) { Store.resume = !Store.resume } }
        item {
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton("Salvar", primary = true) { save() }
                if (Store.serverUrl != null) PillButton("Cancelar", onClick = onDone)
            }
        }
        item { Text("XFinder para TV · versão ${BuildConfigCompat.versionName(LocalContext.current)}", color = Faint, fontSize = 12.sp, modifier = Modifier.padding(top = 18.dp)) }
    }
}

object BuildConfigCompat {
    fun versionName(ctx: android.content.Context): String =
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "?"
}

@Composable
private fun ToggleRow(title: String, desc: String, on: Boolean, onClick: () -> Unit) {
    TvFocusable(Modifier.width(620.dp), RoundedCornerShape(14.dp), 1.03f, onClick = onClick) { f ->
        Row(
            Modifier.fillMaxWidth().background(if (f) Color.White else Surface2).padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, color = if (f) Color.Black else TextPri, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(desc, color = if (f) Color(0xFF444A52) else Dim, fontSize = 12.5.sp)
            }
            Spacer(Modifier.width(16.dp))
            SwitchKnob(on, f)
        }
    }
}

// ───────────────────────────── Peças das páginas de título ─────────────────────────────

/** Imagem de fundo em tela cheia, esmaecida para a esquerda e para baixo (estilo tvOS). */
@Composable
fun Backdrop(url: String?) {
    Box(Modifier.fillMaxSize()) {
        if (!url.isNullOrBlank()) {
            AsyncImage(url, null, contentScale = ContentScale.Crop, alignment = Alignment.TopCenter, alpha = 0.6f, modifier = Modifier.fillMaxSize())
        }
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Bg, 0.45f to Bg.copy(alpha = 0.82f), 1f to Bg.copy(alpha = 0.15f))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.3f to Color.Transparent, 0.75f to Bg.copy(alpha = 0.92f), 1f to Bg)))
    }
}

@Composable
private fun MetaLine(parts: List<String?>) {
    val p = parts.filterNotNull().filter { it.isNotBlank() }
    if (p.isNotEmpty()) Text(p.joinToString("   ·   "), color = Text2, fontSize = 14.sp, fontWeight = FontWeight.Medium)
}

@Composable
private fun Badge(text: String, color: Color = Color.White, fg: Color = Color.Black) {
    Text(
        text, color = fg, fontSize = 10.sp, fontWeight = FontWeight.Black, letterSpacing = 0.8.sp,
        modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(color).padding(horizontal = 7.dp, vertical = 3.dp),
    )
}

fun openPlayer(ctx: android.content.Context, series: Series, srcIdx: Int, ep: Episode? = null) {
    val i = Intent(ctx, PlayerActivity::class.java)
        .putExtra("series", series.toJson().toString()).putExtra("srcIdx", srcIdx)
    if (ep != null) i.putExtra("season", ep.season).putExtra("num", ep.num)
    ctx.startActivity(i)
}

/** Abre a URL do vídeo no seletor de apps (MX Player, VLC…). */
fun openExternal(ctx: android.content.Context, url: String, title: String) {
    val view = Intent(Intent.ACTION_VIEW)
        .setDataAndType(android.net.Uri.parse(url), "video/*")
        .putExtra("title", title)
    try {
        ctx.startActivity(Intent.createChooser(view, "Abrir com"))
    } catch (e: android.content.ActivityNotFoundException) {
        android.widget.Toast.makeText(ctx, "Nenhum outro player instalado", android.widget.Toast.LENGTH_SHORT).show()
    }
}

// ───────────────────────────── Filme / canal ─────────────────────────────

@Composable
fun MediaScreen(item: Series) {
    val ctx = LocalContext.current
    Store.version.intValue
    val isLive = item.type == "live"
    var srcIdx by remember { mutableIntStateOf(Store.preferredSource(item)) }
    val pr = if (isLive) null else Store.progress(item.key, 0, 0)
    val watched = pr?.watched == true
    val resumable = pr != null && pr.pos > 10_000 && !watched && Store.resume
    val playFocus = remember { FocusRequester() }
    InitialFocus(playFocus, Unit)
    val fav = Store.isFavorite(item.key)

    Box(Modifier.fillMaxSize()) {
        Backdrop(if (isLive) null else item.cover)
        Row(Modifier.fillMaxSize().padding(horizontal = Edge, vertical = 40.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(item.title, color = Color.White, fontSize = 36.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 40.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                MetaLine(listOf(
                    if (isLive) "Canal ao vivo" else "Filme", item.year?.toString(),
                    "${item.sources.size} ${if (item.sources.size == 1) "fonte" else "fontes"}",
                    if (watched) "✓ Assistido" else null,
                ))
                if (resumable) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        ProgressLine(pr!!.fraction, Modifier.width(180.dp))
                        Spacer(Modifier.width(12.dp))
                        Text("Faltam ${humanDuration(pr.dur - pr.pos)}", color = Dim, fontSize = 13.sp)
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    val label = when {
                        isLive -> "Assistir ao vivo"
                        resumable -> "Continuar"
                        watched -> "Assistir de novo"
                        else -> "Assistir"
                    }
                    PillButton(label, Ic.Play, primary = true, focusRequester = playFocus) { openPlayer(ctx, item, srcIdx) }
                    if (resumable) PillButton("Do início", Ic.Restart) {
                        Store.saveProgress(item.key, 0, 0, 0, pr!!.dur)
                        openPlayer(ctx, item, srcIdx)
                    }
                    PillButton(null, if (fav) Ic.Star else Ic.StarOutline, iconTint = if (fav) Warn else null) { Store.toggleFavorite(item) }
                    if (!isLive) PillButton(null, if (watched) Ic.Done else Ic.Check, iconTint = if (watched) Green else null) {
                        Store.setWatched(item.key, 0, 0, !watched)
                        if (!watched) Store.clearContinue(item.key)
                    }
                    if (item.sources.size > 1) PillButton("Fonte ${srcIdx + 1}/${item.sources.size}", Ic.Server) {
                        srcIdx = (srcIdx + 1) % item.sources.size
                        Store.setPreferredSource(item.key, item.sources[srcIdx].serverId)
                    }
                }
                if (item.sources.size > 1) Text("Servidor: ${item.sources[srcIdx].serverName}", color = Faint, fontSize = 12.sp)
            }
            Spacer(Modifier.width(40.dp))
            Art(
                item.cover, item.title,
                Modifier.width(if (isLive) 220.dp else 200.dp).aspectRatio(if (isLive) 1f else 2f / 3f).clip(RoundedCornerShape(14.dp)),
                fit = isLive, initialSize = 48,
            )
        }
    }
}

// ───────────────────────────── Série ─────────────────────────────

@Composable
fun SeriesScreen(series: Series) {
    val ctx = LocalContext.current
    Store.version.intValue
    var srcIdx by remember { mutableIntStateOf(Store.preferredSource(series)) }
    var detail by remember { mutableStateOf<Detail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var season by remember { mutableIntStateOf(-1) }
    var menuEp by remember { mutableStateOf<Episode?>(null) }
    var menuSeason by remember { mutableStateOf<Int?>(null) }
    val playFocus = remember { FocusRequester() }
    val epRow = rememberLazyListState()

    LaunchedEffect(series.key, reload) {
        error = null; detail = null
        try {
            val (idx, d) = withContext(Dispatchers.IO) { Repo.loadDetailAny(series, srcIdx) }
            srcIdx = idx
            detail = d
        } catch (e: Exception) {
            error = "Não foi possível carregar os episódios.\n${e.message ?: ""}"
        }
    }

    val d = detail
    if (d == null) {
        Box(Modifier.fillMaxSize()) {
            Backdrop(series.cover)
            Column(Modifier.padding(horizontal = Edge, vertical = 60.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(series.title, color = Color.White, fontSize = 36.sp, fontWeight = FontWeight.ExtraBold)
                if (error != null) {
                    Text(error!!, color = Text2, fontSize = 15.sp)
                    val retry = remember { FocusRequester() }
                    InitialFocus(retry, error)
                    PillButton("Tentar novamente", Ic.Restart, primary = true, focusRequester = retry) { reload++ }
                } else Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Dim, strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("Carregando episódios…", color = Dim, fontSize = 15.sp)
                }
            }
        }
        return
    }

    fun watched(ep: Episode) = Store.progress(series.key, ep.season, ep.num)?.watched == true
    val resume = resumeTarget(series, d)
    val allWatched = d.episodes.isNotEmpty() && d.episodes.all(::watched)
    if (season == -1 || season !in d.seasons) season = resume?.season ?: d.seasons.firstOrNull() ?: 1
    val eps = d.inSeason(season)
    val watchedTotal = d.episodes.count(::watched)
    val seasonDone = eps.isNotEmpty() && eps.all(::watched)
    val fav = Store.isFavorite(series.key)
    val backdrop = d.backdrop ?: d.cover ?: series.cover

    InitialFocus(playFocus, d)
    LaunchedEffect(d, season) {
        val i = eps.indexOfFirst { it.season == resume?.season && it.num == resume?.num }
        epRow.scrollToItem((i - 1).coerceAtLeast(0))
    }

    fun play(ep: Episode) = openPlayer(ctx, series, srcIdx, ep)

    // Layout fixo (sem rolagem): tudo cabe em 960×540 dp, com os episódios ancorados embaixo.
    Box(Modifier.fillMaxSize()) {
        Backdrop(backdrop)
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.padding(start = Edge, end = Edge, top = 30.dp).widthIn(max = 640.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(series.title, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                MetaLine(listOf(
                    series.year?.toString(),
                    d.genre?.split('/', ',')?.firstOrNull()?.trim(),
                    d.rating?.take(3)?.takeIf { (it.replace(',', '.').toDoubleOrNull() ?: 0.0) > 0.0 }?.let { "★ $it" },
                    "${d.seasons.size} ${if (d.seasons.size == 1) "temporada" else "temporadas"}",
                    if (watchedTotal > 0) "$watchedTotal/${d.episodes.size} vistos" else null,
                ))
                if (!d.plot.isNullOrBlank()) Text(d.plot, color = Text2, fontSize = 13.5.sp, lineHeight = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Row(
                Modifier.padding(start = Edge, end = Edge, top = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                val rp = resume?.let { Store.progress(series.key, it.season, it.num) }
                val partial = rp != null && rp.pos > 10_000 && !rp.watched && Store.resume
                val label = when {
                    allWatched -> "Assistir de novo"
                    resume != null && partial -> "Continuar T${resume.season}:E${resume.num}"
                    resume != null && watchedTotal > 0 -> "Próximo: T${resume.season}:E${resume.num}"
                    resume != null -> "Começar T${resume.season}:E${resume.num}"
                    else -> "Assistir"
                }
                PillButton(label, Ic.Play, primary = true, focusRequester = playFocus) {
                    (if (allWatched) d.episodes.firstOrNull() else resume)?.let(::play)
                }
                PillButton(null, if (fav) Ic.Star else Ic.StarOutline, iconTint = if (fav) Warn else null) { Store.toggleFavorite(series) }
                if (series.sources.size > 1) PillButton("Fonte ${srcIdx + 1}/${series.sources.size}", Ic.Server) {
                    val n = (srcIdx + 1) % series.sources.size
                    srcIdx = n
                    Store.setPreferredSource(series.key, series.sources[n].serverId)
                    season = -1
                    reload++
                }
                if (partial) Text("Faltam ${humanDuration(rp!!.dur - rp.pos)}", color = Dim, fontSize = 13.sp)
            }

            Spacer(Modifier.weight(1f))

            // ── Temporadas ──
            LazyRow(
                contentPadding = PaddingValues(horizontal = Edge, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                items(d.seasons) { s ->
                    val list = d.inSeason(s)
                    val seen = list.count(::watched)
                    SeasonTab(
                        "Temporada $s", if (seen == list.size) "✓" else "$seen/${list.size}", s == season,
                        onLong = { season = s; menuSeason = s },
                    ) { season = s }
                }
                item {
                    Text("Segure OK numa temporada ou episódio para mais opções", color = Faint, fontSize = 12.sp, modifier = Modifier.padding(start = 12.dp))
                }
            }

            // ── Episódios ──
            LazyRow(
                state = epRow,
                contentPadding = PaddingValues(start = Edge, end = Edge, top = 14.dp, bottom = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                items(eps, key = { "${it.season}x${it.num}" }) { ep ->
                    EpisodeCard(
                        series, ep, backdrop,
                        isNext = !allWatched && ep.season == resume?.season && ep.num == resume?.num,
                        onLong = { menuEp = ep },
                    ) { play(ep) }
                }
            }
        }
    }

    menuSeason?.let { s ->
        val list = d.inSeason(s)
        val done = list.isNotEmpty() && list.all(::watched)
        SeasonMenu(
            s, list.count(::watched), list.size, done,
            onToggle = { Store.setSeasonWatched(series.key, list, !done); menuSeason = null },
            onDismiss = { menuSeason = null },
        )
    }

    menuEp?.let { ep ->
        EpisodeMenu(
            series, ep, d,
            onPlay = { menuEp = null; play(ep) },
            onExternal = {
                menuEp = null
                // a lista de episódios carregada é a da fonte atual (srcIdx)
                val src = series.sources[srcIdx]
                Store.setContinue(series, ep.season, ep.num, ep.image ?: d.backdrop)
                openExternal(ctx, src.streamUrl(ep.id, ep.ext), "${series.title} · T${ep.season}:E${ep.num}")
            },
            onDismiss = { menuEp = null },
        )
    }
}

@Composable
private fun SeasonMenu(season: Int, seen: Int, total: Int, done: Boolean, onToggle: () -> Unit, onDismiss: () -> Unit) {
    val first = remember { FocusRequester() }
    InitialFocus(first, Unit)
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.width(440.dp).clip(RoundedCornerShape(20.dp)).background(Surface2).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("$seen de $total episódios vistos", color = Dim, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text("Temporada $season", color = TextPri, fontSize = 19.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            MenuItem(
                if (done) "Desmarcar temporada" else "Marcar temporada como vista",
                icon = if (done) Ic.Undo else Ic.Done, focusRequester = first, onClick = onToggle,
            )
            MenuItem("Fechar", icon = Ic.Close, onClick = onDismiss)
        }
    }
}

@Composable
private fun SeasonTab(label: String, count: String, selected: Boolean, onLong: () -> Unit, onClick: () -> Unit) {
    TvFocusable(shape = CircleShape, focusedScale = 1.07f, onLongClick = onLong, onClick = onClick) { f ->
        Row(
            Modifier.background(when { f -> Color.White; selected -> Color(0x40FFFFFF); else -> Color.Transparent })
                .padding(horizontal = 18.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = if (f) Color.Black else if (selected) Color.White else Dim, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.width(8.dp))
            Text(count, color = if (f) Color(0xFF555B63) else if (count == "✓") Green else Faint, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun EpisodeCard(series: Series, ep: Episode, fallbackImage: String?, isNext: Boolean, onLong: () -> Unit, onPlay: () -> Unit) {
    val pr = Store.progress(series.key, ep.season, ep.num)
    val watched = pr?.watched == true
    val partial = !watched && pr != null && pr.pos > 10_000
    var focused by remember { mutableStateOf(false) }
    Column(Modifier.width(220.dp)) {
        TvFocusable(
            Modifier.fillMaxWidth().aspectRatio(16f / 9f), RoundedCornerShape(12.dp), 1.08f,
            onFocus = { focused = true }, onLongClick = onLong, onClick = onPlay,
        ) { f ->
            if (!f) focused = false
            Art(ep.image ?: fallbackImage, "${ep.num}", Modifier.fillMaxSize(), initialSize = 34)
            if (ep.image == null) {
                // fundo da série como miniatura: escurece e mostra o número
                Box(Modifier.fillMaxSize().background(Color(0x8C000000)))
                Text("E${ep.num}", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Black, modifier = Modifier.align(Alignment.Center))
            }
            Row(Modifier.align(Alignment.TopStart).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (isNext) Badge(if (partial) "CONTINUAR" else "PRÓXIMO")
            }
            if (watched) {
                Box(
                    Modifier.align(Alignment.TopEnd).padding(10.dp).size(24.dp).clip(CircleShape).background(Color.White),
                    contentAlignment = Alignment.Center,
                ) { Icon(Ic.Check, "Visto", Modifier.size(16.dp), tint = Color.Black) }
            }
            if (partial) ProgressLine(pr!!.fraction, Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(12.dp))
        }
        Spacer(Modifier.height(12.dp))
        val meta = listOfNotNull(
            "EPISÓDIO ${ep.num}",
            ep.durationSecs.takeIf { it > 0 }?.let { humanDuration(it * 1000L).uppercase() },
            if (partial) "FALTAM ${humanDuration(pr!!.dur - pr.pos).uppercase()}" else null,
        ).joinToString(" · ")
        Text(meta, color = if (isNext) AccentText else Faint, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp, maxLines = 1)
        Spacer(Modifier.height(4.dp))
        Text(
            cleanEpisodeTitle(ep.title, series.title, ep.num), color = if (focused) Color.White else if (watched) Dim else TextPri,
            fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(4.dp))
        Text(ep.plot ?: "", color = Dim, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.height(32.dp))
    }
}

/** "Série - S01E03 - Título" → "Título" (ou "Episódio 3" se não sobrar nada). */
fun cleanEpisodeTitle(raw: String, seriesTitle: String, num: Int): String {
    var t = raw.trim()
    if (t.startsWith(seriesTitle, ignoreCase = true)) t = t.substring(seriesTitle.length)
    t = t.replace(Regex("^[\\s\\-–:|.]*(S\\d+\\s*E\\d+|T\\d+\\s*E\\d+|\\d+x\\d+)?[\\s\\-–:|.]*", RegexOption.IGNORE_CASE), "").trim()
    return t.ifBlank { "Episódio $num" }
}

@Composable
private fun EpisodeMenu(series: Series, ep: Episode, d: Detail, onPlay: () -> Unit, onExternal: () -> Unit, onDismiss: () -> Unit) {
    val pr = Store.progress(series.key, ep.season, ep.num)
    val watched = pr?.watched == true
    val partial = !watched && pr != null && pr.pos > 10_000
    val first = remember { FocusRequester() }
    InitialFocus(first, Unit)
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.width(440.dp).clip(RoundedCornerShape(20.dp)).background(Surface2).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("T${ep.season}:E${ep.num}", color = Dim, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text(cleanEpisodeTitle(ep.title, series.title, ep.num), color = TextPri, fontSize = 19.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(12.dp))
            MenuItem(if (partial) "Continuar de ${fmt(pr!!.pos)}" else "Assistir", icon = Ic.Play, focusRequester = first, onClick = onPlay)
            if (partial) MenuItem("Assistir do início", icon = Ic.Restart) {
                Store.setWatched(series.key, ep.season, ep.num, false)
                onPlay()
            }
            MenuItem(if (watched) "Marcar como não visto" else "Marcar como visto", icon = if (watched) Ic.Undo else Ic.Check) {
                Store.setWatched(series.key, ep.season, ep.num, !watched)
                onDismiss()
            }
            MenuItem("Marcar como visto até aqui", sub = "Este e todos os episódios anteriores", icon = Ic.Done) {
                val idx = d.episodes.indexOfFirst { it.season == ep.season && it.num == ep.num }
                Store.setSeasonWatched(series.key, d.episodes.take(idx + 1), true)
                onDismiss()
            }
            MenuItem("Abrir com outro player", sub = "MX Player, VLC, Smarters…", icon = Ic.External, onClick = onExternal)
            MenuItem("Fechar", icon = Ic.Close, onClick = onDismiss)
        }
    }
}

/** Episódio a retomar: o de "continuar assistindo" ou o primeiro não visto. */
fun resumeTarget(series: Series, d: Detail): Episode? {
    fun unseen(e: Episode) = Store.progress(series.key, e.season, e.num)?.watched != true
    Store.continueFor(series.key)?.let { c ->
        d.find(c.season, c.num)?.let { ep ->
            if (unseen(ep)) return ep
            // já visto (ex.: marcado pelo menu): segue para o próximo não visto depois dele
            d.episodes.drop(d.episodes.indexOf(ep) + 1).firstOrNull(::unseen)?.let { return it }
        }
    }
    return d.episodes.firstOrNull(::unseen) ?: d.episodes.firstOrNull()
}
