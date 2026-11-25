package br.xfinder.series

import android.view.KeyEvent as AKey
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

// ─── Tokens (mesmos do painel web, tema escuro) ─────────────────────────────
val Bg = Color(0xFF0B0D10)
val Surface = Color(0xFF13161B)
val Surface2 = Color(0xFF1A1E25)
val Border = Color(0xFF2C323B)
val TextPri = Color(0xFFE8EAED)
val Text2 = Color(0xFFC3C9D1)
val Dim = Color(0xFF9AA3AD)
val Faint = Color(0xFF7D8691)
val Accent = Color(0xFF4C8DFF)
val AccentText = Color(0xFF9EC2FF)
val Green = Color(0xFF3DDC97)
val Danger = Color(0xFFFF6B6B)
val Warn = Color(0xFFF5B04A)
/** Fundo translúcido dos botões sem foco (estilo tvOS). */
val Glass = Color(0x29FFFFFF)

/** Margem lateral segura para TV (overscan). */
val Edge = 48.dp

// ─── Ícones (paths Material, sem depender do pacote de ícones) ─────────────
private fun icon(vararg paths: String): ImageVector =
    ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .apply { paths.forEach { addPath(PathParser().parsePathString(it).toNodes(), fill = SolidColor(Color.Black)) } }
        .build()

object Ic {
    val Play by lazy { icon("M8 5v14l11-7z") }
    val Pause by lazy { icon("M6 19h4V5H6v14zm8-14v14h4V5h-4z") }
    val Next by lazy { icon("M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z") }
    val Prev by lazy { icon("M6 6h2v12H6z", "M9.5 12L18 18V6z") }
    val Forward by lazy { icon("M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z") }
    val Rewind by lazy { icon("M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z") }
    val Subtitles by lazy { icon("M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z") }
    val Audio by lazy { icon("M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z") }
    val Aspect by lazy { icon("M19 12h-2v3h-3v2h5v-5zM7 9h3V7H5v5h2V9zm14-6H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.99h18v14.02z") }
    val Server by lazy { icon("M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z") }
    val External by lazy { icon("M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z") }
    val Restart by lazy { icon("M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z") }
    val Star by lazy { icon("M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z") }
    val StarOutline by lazy { icon("M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z") }
    val Check by lazy { icon("M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z") }
    val Search by lazy { icon("M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z") }
    val Settings by lazy { icon("M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z") }
    val Warning by lazy { icon("M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z") }
    val Undo by lazy { icon("M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z") }
    val Done by lazy { icon("M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z") }
    val Plus by lazy { icon("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z") }
    val Edit by lazy { icon("M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z") }
    val Person by lazy { icon("M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z") }
    val Close by lazy { icon("M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z") }
}

// ─── Foco estilo tvOS ───────────────────────────────────────────────────────

/**
 * Contêiner focável pelo controle remoto: ao receber foco cresce e ganha
 * sombra (como na Apple TV). OK = clique; segurar OK = clique longo.
 */
@Composable
fun TvFocusable(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(12.dp),
    focusedScale: Float = 1.06f,
    focusRequester: FocusRequester? = null,
    onFocus: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) focusedScale else 1f, tween(170), label = "focusScale")
    // A tecla OK precisa ter sido pressionada AQUI: o "soltar" que sobra da
    // tela anterior não pode disparar um clique nesta.
    var pressed by remember { mutableStateOf(false) }
    var longFired by remember { mutableStateOf(false) }
    val click by rememberUpdatedState(onClick)
    val longClick by rememberUpdatedState(onLongClick)
    Box(
        modifier
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .onFocusChanged {
                focused = it.isFocused
                if (!it.isFocused) pressed = false
                if (it.isFocused) onFocus?.invoke()
            }
            .onKeyEvent { e ->
                val k = e.nativeKeyEvent
                if (k.keyCode != AKey.KEYCODE_DPAD_CENTER && k.keyCode != AKey.KEYCODE_ENTER &&
                    k.keyCode != AKey.KEYCODE_NUMPAD_ENTER) return@onKeyEvent false
                when (k.action) {
                    AKey.ACTION_DOWN -> {
                        if (k.repeatCount == 0) { pressed = true; longFired = false }
                        else if (pressed && !longFired && longClick != null) { longFired = true; longClick?.invoke() }
                        true
                    }
                    AKey.ACTION_UP -> {
                        if (pressed && !longFired) click()
                        pressed = false
                        true
                    }
                    else -> false
                }
            }
            .focusable()
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .shadow(if (focused) 16.dp else 0.dp, shape, clip = false)
            .clip(shape)
            .pointerInput(Unit) {
                detectTapGestures(onTap = { click() }, onLongPress = { longClick?.invoke() })
            }
    ) { content(focused) }
}

/** Botão em pílula: translúcido sem foco, branco com foco. */
@Composable
fun PillButton(
    text: String?,
    icon: ImageVector? = null,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    focusRequester: FocusRequester? = null,
    iconTint: Color? = null,
    onFocus: (() -> Unit)? = null,
    onClick: () -> Unit,
) {
    TvFocusable(modifier, CircleShape, 1.07f, focusRequester, onFocus, onClick = onClick) { f ->
        val bg = when { f -> Color.White; primary -> TextPri; else -> Glass }
        val fg = if (f || primary) Color.Black else TextPri
        Row(
            Modifier.background(bg).then(
                if (text == null) Modifier.size(46.dp) else Modifier.height(46.dp).padding(horizontal = 22.dp)
            ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            if (icon != null) Icon(icon, text, Modifier.size(22.dp), tint = if (f) fg else iconTint ?: fg)
            if (icon != null && text != null) Spacer(Modifier.width(8.dp))
            if (text != null) Text(text, color = fg, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** Linha de menu (diálogos e painéis laterais). */
@Composable
fun MenuItem(
    text: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    icon: ImageVector? = null,
    selected: Boolean = false,
    dot: Color? = null,
    badge: String? = null,
    focusRequester: FocusRequester? = null,
    onClick: () -> Unit,
) {
    TvFocusable(modifier.fillMaxWidth(), RoundedCornerShape(12.dp), 1.03f, focusRequester, onClick = onClick) { f ->
        val fg = if (f) Color.Black else TextPri
        Row(
            Modifier.fillMaxWidth().background(if (f) Color.White else Color.Transparent)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (dot != null) {
                Box(Modifier.size(9.dp).clip(CircleShape).background(dot))
                Spacer(Modifier.width(14.dp))
            }
            if (icon != null) {
                Icon(icon, null, Modifier.size(20.dp), tint = fg)
                Spacer(Modifier.width(14.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(text, color = fg, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (sub != null) Text(sub, color = if (f) Color(0xFF444A52) else Dim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (badge != null) Text(badge, color = if (f) Color(0xFF444A52) else AccentText, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            if (selected) {
                Spacer(Modifier.width(10.dp))
                Icon(Ic.Check, null, Modifier.size(20.dp), tint = if (f) Color.Black else AccentText)
            }
        }
    }
}

// ─── Imagens e cartões ──────────────────────────────────────────────────────

/** Capa com a inicial do título como reserva enquanto carrega (ou se falhar). */
@Composable
fun Art(url: String?, title: String, modifier: Modifier = Modifier, fit: Boolean = false, initialSize: Int = 30) {
    Box(modifier.background(Surface2)) {
        Text(
            title.trim().take(1).uppercase(), color = Faint, fontSize = initialSize.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.Center),
        )
        if (!url.isNullOrBlank()) {
            AsyncImage(
                url, title,
                contentScale = if (fit) ContentScale.Fit else ContentScale.Crop,
                alignment = Alignment.TopCenter,
                modifier = Modifier.fillMaxSize().then(if (fit) Modifier.padding(14.dp) else Modifier),
            )
        }
    }
}

/** Barra de progresso fina e arredondada. */
@Composable
fun ProgressLine(fraction: Float, modifier: Modifier = Modifier, color: Color = Color.White, track: Color = Color(0x4DFFFFFF), height: Dp = 4.dp) {
    Box(modifier.height(height).clip(CircleShape).background(track)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).background(color))
    }
}

/** Pôster 2:3 (canais: quadrado, com logo inteiro). */
@Composable
fun PosterCard(
    title: String, cover: String?, subtitle: String? = null,
    modifier: Modifier = Modifier, live: Boolean = false,
    focusRequester: FocusRequester? = null, onFocus: (() -> Unit)? = null, onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    Column(modifier) {
        TvFocusable(
            Modifier.fillMaxWidth().aspectRatio(if (live) 1f else 2f / 3f), RoundedCornerShape(12.dp), 1.08f,
            focusRequester, { focused = true; onFocus?.invoke() }, onClick = onClick,
        ) { f ->
            if (!f) focused = false
            Art(cover, title, Modifier.fillMaxSize(), fit = live)
        }
        Spacer(Modifier.height(10.dp))
        Text(title, color = if (focused) Color.White else Text2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
        if (subtitle != null) Text(subtitle, color = Faint, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Cartão 16:9 com título e progresso (Continuar assistindo). */
@Composable
fun WideCard(
    title: String, subtitle: String?, image: String?, progress: Float,
    modifier: Modifier = Modifier, focusRequester: FocusRequester? = null,
    onFocus: (() -> Unit)? = null, onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    Column(modifier) {
        TvFocusable(
            Modifier.fillMaxWidth().aspectRatio(16f / 9f), RoundedCornerShape(12.dp), 1.07f,
            focusRequester, { focused = true; onFocus?.invoke() }, onClick = onClick,
        ) { f ->
            if (!f) focused = false
            Art(image, title, Modifier.fillMaxSize())
            if (progress > 0f) {
                ProgressLine(progress, Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(12.dp))
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(title, color = if (focused) Color.White else Text2, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
        if (subtitle != null) Text(subtitle, color = Faint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun ShelfTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text, color = TextPri, fontSize = 18.sp, fontWeight = FontWeight.Bold,
        modifier = modifier.padding(start = Edge, top = 18.dp),
    )
}

/** Campo de texto "vidro" (busca, endereço do servidor). */
@Composable
fun GlassField(
    value: String, onChange: (String) -> Unit, placeholder: String,
    modifier: Modifier = Modifier, focusRequester: FocusRequester? = null,
    leading: ImageVector? = null, imeAction: ImeAction = ImeAction.Search, onAction: () -> Unit = {},
) {
    var focused by remember { mutableStateOf(false) }
    val fm = LocalFocusManager.current
    // TextFieldValue local para saber onde está o cursor
    var tfv by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
    if (tfv.text != value) tfv = TextFieldValue(value, TextRange(value.length))
    BasicTextField(
        value = tfv, onValueChange = { tfv = it; if (it.text != value) onChange(it.text) }, singleLine = true,
        textStyle = TextStyle(color = TextPri, fontSize = 17.sp),
        cursorBrush = SolidColor(Color.White),
        keyboardOptions = KeyboardOptions(imeAction = imeAction),
        keyboardActions = KeyboardActions(onAny = { onAction() }),
        modifier = modifier
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .onFocusChanged { focused = it.isFocused }
            // O campo de texto prende as setas do D-pad (movem o cursor). Aqui ↑/↓
            // sempre saem do campo, e ←/→ saem quando o cursor está na ponta.
            .onPreviewKeyEvent { e ->
                val k = e.nativeKeyEvent
                if (k.action != AKey.ACTION_DOWN) return@onPreviewKeyEvent false
                val sel = tfv.selection
                when (k.keyCode) {
                    AKey.KEYCODE_DPAD_DOWN -> fm.moveFocus(FocusDirection.Down)
                    AKey.KEYCODE_DPAD_UP -> fm.moveFocus(FocusDirection.Up)
                    AKey.KEYCODE_DPAD_RIGHT -> sel.collapsed && sel.end >= tfv.text.length && fm.moveFocus(FocusDirection.Right)
                    AKey.KEYCODE_DPAD_LEFT -> sel.collapsed && sel.start == 0 && fm.moveFocus(FocusDirection.Left)
                    else -> false
                }
            },
        decorationBox = { inner ->
            Row(
                Modifier.height(50.dp).clip(CircleShape)
                    .background(if (focused) Color(0x3DFFFFFF) else Color(0x1FFFFFFF))
                    .border(BorderStroke(2.dp, if (focused) Color.White else Color.Transparent), CircleShape)
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (leading != null) {
                    Icon(leading, null, Modifier.size(20.dp), tint = Dim)
                    Spacer(Modifier.width(12.dp))
                }
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(placeholder, color = Faint, fontSize = 17.sp, maxLines = 1)
                    inner()
                }
            }
        },
    )
}

/** Interruptor liga/desliga desenhado (sem Material). */
@Composable
fun SwitchKnob(on: Boolean, focused: Boolean) {
    val x by animateFloatAsState(if (on) 1f else 0f, tween(160), label = "knob")
    Box(
        Modifier.size(width = 46.dp, height = 26.dp).clip(CircleShape)
            .background(if (on) Green else if (focused) Color(0xFFB8BEC6) else Color(0xFF3A414C))
    ) {
        Box(
            Modifier.padding(3.dp).offset(x = (20 * x).dp).size(20.dp).clip(CircleShape)
                .background(Color.White)
        )
    }
}

fun fmt(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    val h = s / 3600; val m = (s % 3600) / 60; val sec = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%d:%02d".format(m, sec)
}

/** "42 min" / "1h 05min". */
fun humanDuration(ms: Long): String {
    val m = (ms / 60_000).coerceAtLeast(1)
    return if (m >= 60) "${m / 60}h %02dmin".format(m % 60) else "$m min"
}
