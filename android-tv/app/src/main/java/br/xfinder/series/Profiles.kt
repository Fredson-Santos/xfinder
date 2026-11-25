package br.xfinder.series

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Cores de avatar; o perfil guarda só o índice (como texto). */
private val AvatarColors = listOf(
    Color(0xFF4C8DFF) to Color(0xFF2B5BD7),
    Color(0xFFFF6B6B) to Color(0xFFC83A5A),
    Color(0xFF3DDC97) to Color(0xFF1B9E78),
    Color(0xFFF5B04A) to Color(0xFFD9772B),
    Color(0xFFB57BFF) to Color(0xFF7A4CD6),
    Color(0xFF4DD0E1) to Color(0xFF2A8FA8),
    Color(0xFFFF8AC4) to Color(0xFFD14E94),
    Color(0xFF9AA3AD) to Color(0xFF5F6872),
)

private const val MaxProfiles = 8

@Composable
fun ProfileAvatar(profile: Profile, size: Dp, modifier: Modifier = Modifier) {
    val (a, b) = AvatarColors[(profile.avatar.toIntOrNull() ?: 0).mod(AvatarColors.size)]
    Box(
        modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(a, b))),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            profile.name.trim().take(1).uppercase().ifEmpty { "?" },
            color = Color.White, fontSize = (size.value * 0.44f).sp, fontWeight = FontWeight.Bold,
        )
    }
}

/** "Quem está assistindo?": escolha, criação e edição de perfis. */
@Composable
fun ProfileScreen(onChosen: () -> Unit, onSettings: () -> Unit) {
    var profiles by remember { mutableStateOf(Store.cachedProfiles()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var manage by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Profile?>(null) } // id 0 = novo
    var reload by remember { mutableIntStateOf(0) }
    val first = remember { FocusRequester() }

    LaunchedEffect(reload) {
        loading = true
        try {
            val list = withContext(Dispatchers.IO) { Repo.profiles() }
            Store.cacheProfiles(list)
            profiles = list
            error = null
        } catch (e: Exception) {
            error = if (profiles.isEmpty()) "Não foi possível falar com o servidor (${e.message})." else "Sem conexão com o servidor: mostrando os perfis salvos."
        }
        loading = false
    }
    InitialFocus(first, profiles.size, loading)

    fun choose(p: Profile) {
        Store.enterProfile(p)
        onChosen()
    }

    Column(Modifier.fillMaxSize().padding(horizontal = Edge), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.weight(1f))
        Text(
            if (manage) "Gerenciar perfis" else "Quem está assistindo?",
            color = TextPri, fontSize = 36.sp, fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(44.dp))

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(30.dp, Alignment.CenterHorizontally),
            modifier = Modifier.fillMaxWidth(),
        ) {
            items(profiles, key = { it.id }) { p ->
                ProfileTile(
                    label = p.name, requester = if (p == profiles.first()) first else null,
                    onLongClick = { editing = p },
                    onClick = { if (manage) editing = p else choose(p) },
                ) { f ->
                    ProfileAvatar(p, 130.dp, Modifier.border(BorderStroke(3.dp, if (f) Color.White else Color.Transparent), CircleShape))
                    if (manage) EditBadge()
                }
            }
            if (profiles.size < MaxProfiles && (!loading || profiles.isNotEmpty())) {
                item(key = "add") {
                    ProfileTile(
                        label = "Adicionar perfil", requester = if (profiles.isEmpty()) first else null,
                        onClick = { editing = Profile(0, "", "${profiles.size % AvatarColors.size}") },
                    ) { f ->
                        Box(
                            Modifier.size(130.dp).clip(CircleShape).background(Glass)
                                .border(BorderStroke(3.dp, if (f) Color.White else Color.Transparent), CircleShape),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Ic.Plus, "Adicionar perfil", Modifier.size(54.dp), tint = if (f) Color.White else Dim) }
                    }
                }
            }
        }

        Spacer(Modifier.height(30.dp))
        Box(Modifier.height(24.dp), contentAlignment = Alignment.Center) {
            when {
                loading && profiles.isEmpty() -> CircularProgressIndicator(Modifier.size(22.dp), color = Accent, strokeWidth = 2.dp)
                error != null -> Text(error!!, color = Warn, fontSize = 14.sp, textAlign = TextAlign.Center)
            }
        }
        Spacer(Modifier.height(30.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (profiles.isNotEmpty()) PillButton(if (manage) "Concluído" else "Gerenciar perfis", Ic.Edit.takeIf { !manage }) { manage = !manage }
            if (error != null) PillButton("Tentar de novo", Ic.Restart) { reload++ }
            PillButton("Servidor", Ic.Server, onClick = onSettings)
        }
        Spacer(Modifier.weight(1f))
    }

    editing?.let { target ->
        ProfileEditor(
            profile = target,
            onDismiss = { editing = null },
            onSaved = { editing = null; reload++ },
            isFirst = profiles.isEmpty(),
        )
    }
}

@Composable
private fun ProfileTile(
    label: String,
    requester: FocusRequester?,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
    avatar: @Composable androidx.compose.foundation.layout.BoxScope.(Boolean) -> Unit,
) {
    TvFocusable(
        Modifier.width(150.dp), RoundedCornerShape(16.dp), 1.1f, requester,
        onLongClick = onLongClick, onClick = onClick,
    ) { f ->
        Column(Modifier.padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(contentAlignment = Alignment.BottomEnd) { avatar(f) }
            Spacer(Modifier.height(12.dp))
            Text(
                label, color = if (f) Color.White else Dim, fontSize = 17.sp,
                fontWeight = if (f) FontWeight.Bold else FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.EditBadge() {
    Box(
        Modifier.align(Alignment.BottomEnd).size(38.dp).clip(CircleShape).background(Color(0xCC000000)),
        contentAlignment = Alignment.Center,
    ) { Icon(Ic.Edit, "Editar", Modifier.size(20.dp), tint = Color.White) }
}

/** Diálogo de criar/editar/excluir perfil. */
@Composable
private fun ProfileEditor(profile: Profile, onDismiss: () -> Unit, onSaved: () -> Unit, isFirst: Boolean) {
    val isNew = profile.id == 0L
    var name by remember { mutableStateOf(profile.name) }
    var avatar by remember { mutableStateOf(profile.avatar.ifEmpty { "0" }) }
    var busy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val nameFocus = remember { FocusRequester() }
    val saveFocus = remember { FocusRequester() }
    InitialFocus(if (isNew) nameFocus else saveFocus, Unit)

    fun save() {
        val n = name.trim()
        if (n.isEmpty() || busy) { if (n.isEmpty()) error = "Digite um nome."; return }
        busy = true
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (isNew) {
                        val created = Repo.createProfile(n, avatar)
                        // 1º perfil: leva os favoritos e o progresso de antes dos perfis
                        if (isFirst && Store.hasLegacy()) Store.importLegacy(created.id)
                    } else Repo.updateProfile(profile.id, n, avatar)
                }
                onSaved()
            } catch (e: Exception) {
                error = "Não foi possível salvar (${e.message})."
                busy = false
            }
        }
    }

    fun delete() {
        if (busy) return
        busy = true
        scope.launch {
            try {
                withContext(Dispatchers.IO) { Repo.deleteProfile(profile.id) }
                Store.forgetProfile(profile.id)
                onSaved()
            } catch (e: Exception) {
                error = "Não foi possível excluir (${e.message})."
                busy = false
            }
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.clip(RoundedCornerShape(24.dp)).background(Surface).border(BorderStroke(1.dp, Border), RoundedCornerShape(24.dp)).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(if (isNew) "Novo perfil" else "Editar perfil", color = TextPri, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(20.dp))
            ProfileAvatar(Profile(profile.id, name, avatar), 96.dp)
            Spacer(Modifier.height(20.dp))
            GlassField(name, { name = it; error = null }, "Nome do perfil", Modifier.width(380.dp), nameFocus, Ic.Person, ImeAction.Done, onAction = { save() })
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AvatarColors.indices.forEach { i ->
                    val sel = avatar == i.toString()
                    TvFocusable(Modifier.size(44.dp), CircleShape, 1.15f, onClick = { avatar = i.toString() }) { f ->
                        Box(
                            Modifier.size(44.dp).background(Brush.linearGradient(listOf(AvatarColors[i].first, AvatarColors[i].second)))
                                .border(BorderStroke(3.dp, if (f) Color.White else if (sel) Color(0x99FFFFFF) else Color.Transparent), CircleShape),
                            contentAlignment = Alignment.Center,
                        ) { if (sel) Icon(Ic.Check, null, Modifier.size(22.dp), tint = Color.White) }
                    }
                }
            }
            Box(Modifier.padding(top = 14.dp).height(20.dp)) {
                error?.let { Text(it, color = Danger, fontSize = 13.sp) }
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton(if (busy) "Aguarde…" else "Salvar", primary = true, focusRequester = saveFocus) { save() }
                PillButton("Cancelar", onClick = onDismiss)
                if (!isNew) PillButton(if (confirmDelete) "Confirmar exclusão" else "Excluir", iconTint = Danger) {
                    if (confirmDelete) delete() else confirmDelete = true
                }
            }
            if (confirmDelete) Text(
                "Isto apaga os favoritos e o histórico deste perfil.",
                color = Warn, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}
