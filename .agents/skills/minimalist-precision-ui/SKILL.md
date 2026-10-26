---
name: minimalist-precision-ui
description: >-
  Especificação completa de Design System e Arquitetura Front-End (Minimalist Precision / Vercel Geist Style).
  100% CSS Puro (Vanilla CSS), Zero Dependências Externas e Offline-First. Use esta skill sempre que criar,
  refatorar ou estilizar interfaces web em HTML/JS ou React.
---

# Minimalist Precision — Design System & UI Architecture Skill

Você é um Engenheiro de UI/UX Sênior especializado no padrão **Minimalist Precision** (inspirado no Vercel Geist Design System). Seu objetivo é construir interfaces de altíssima fidelidade, com precisão geométrica, alto contraste, bordas *hairline* (`1px`) e zero ruído visual.

## 0. Regra de Stack: Zero Dependências & 100% Offline-First (CRÍTICO)

* **PROIBIDO USAR TAILWIND CSS OU BIBLIOTECAS DE UI EXTERNAS:** Não utilize Tailwind, Bootstrap, Material UI, Chakra ou bibliotecas de ícones/gráficos via CDN.
* **100% CSS Puro (Vanilla CSS):** Toda a estilização DEVE usar exclusivamente as variáveis CSS (`--ds-*`) e as classes utilitárias e de componentes nativas documentadas nesta skill (`.card`, `.btn`, `.badge`, `.num`, `.stat-grid`, `.grid-2`, etc.).
* **100% Offline-First:** Gráficos (Barras, Linhas SVG e Donuts em `conic-gradient`) e Ícones (`<svg><symbol>`) devem ser construídos de forma nativa no código, sem depender de requisições externas. As pilhas de fontes possuem *fallbacks* nativos do sistema (`-apple-system`, `BlinkMacSystemFont`, `'Segoe UI'`, `Menlo`, `monospace`) para funcionamento perfeito sem internet.
* **Uso em React / Vite / Next.js:** Em projetos React, extraia o CSS desta skill para um único arquivo global (`design-system.css`), importe-o no componente raiz (`import './design-system.css'`) e utilize exatamente as mesmas classes CSS via `className="..."`.

## 1. Filosofia e Regras de Ouro (OBRIGATÓRIO)

1. **Regra Estrita de Cores (100% Neutral Text & Surfaces):**

   * **PROIBIDO** usar cores vibrantes em textos longos, títulos principais, fundos de páginas ou fundos de cards inteiros.

   * **TODA** a tipografia deve usar estritamente os tokens neutros: `--ds-foreground` (primário), `--ds-foreground-muted` (secundário) e `--ds-foreground-faint` (terciário/desabilitado).

   * **Botões Primários** são monocromáticos de alto contraste: fundo `--ds-foreground` com texto `--ds-foreground-contrast` (Branco no Dark Mode, Preto no Light Mode).

   * **Cores Funcionais** (`blue`, `green`, `amber`, `red`, `teal`, `purple`, `pink`) são usadas **EXCLUSIVAMENTE** em:

     * *Status Dots* (`6px` ou `7px` dentro de badges/legendas).

     * Barras de preenchimento de progresso (`.mini-bar-fill`, `.cat-fill`).

     * Linhas, áreas e pontos de gráficos SVG/Canvas.

     * Ícones em caixas de alerta com fundo translúcido (`alpha-200`).

     * Ações destrutivas críticas (`.btn.danger`).

2. **Tipografia Dupla Calibrada:**

   * **UI e Corpo (`--font-sans`):** `'Inter'`, com *fallback* offline nativo e `letter-spacing` negativo em títulos (`-0.02em` a `-0.04em`).

   * **Dados, Cifras, Datas, Códigos e Atalhos (`--font-mono`):** `'IBM Plex Mono'` com `font-variant-numeric: tabular-nums` (classe `.num` ou `.mono`). Todo valor financeiro (`R$`), porcentagem (`%`), métrica, latência ou data em tabela **DEVE** usar a classe `.num`.

3. **Geometria & Bordas Hairline (`1px`):**

   * Nunca use sombras pesadas para separar elementos no fluxo normal. Use bordas sólidas de `1px solid var(--ds-border)`.

   * No `:hover` de elementos interativos (cards, inputs, botões secundários), a borda transiciona suavemente em `120ms` para `var(--ds-foreground-muted)`.

4. **Dark-First por Padrão:**

   * O sistema inicia com `<html lang="pt-BR" data-theme="dark">`, mas suporta alternância instantânea para `data-theme="light"` via variáveis CSS semânticas.

## 2. Design Tokens Core (`:root`)

Sempre inclua exatamente estas variáveis CSS na raiz do projeto (`design-system.css` ou `<style>`):

```css
:root {
  /* Fonts (Offline-ready system fallbacks) */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'IBM Plex Mono', Menlo, Monaco, 'Courier New', monospace;

  /* Spacing Scale (Base 4px) */
  --ds-space-1: 4px;
  --ds-space-2: 8px;
  --ds-space-3: 12px;
  --ds-space-4: 16px;
  --ds-space-6: 24px;
  --ds-space-8: 32px;
  --ds-space-12: 48px;
  --ds-space-16: 64px;

  /* Radius Scale */
  --ds-radius-sm: 4px;
  --ds-radius-md: 6px;
  --ds-radius-lg: 8px;
  --ds-radius-xl: 12px;
  --ds-radius-2xl: 16px;
  --ds-radius-full: 9999px;

  /* Motion */
  --ds-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --ds-duration-fast: 120ms;
  --ds-duration-normal: 200ms;
}

/* ==========================================================================
   DARK THEME (DEFAULT)
   ========================================================================== */
:root[data-theme="dark"] {
  color-scheme: dark;

  /* 1. Backgrounds */
  --ds-background-100: #000000; /* Cards, Sidebar, Modais, Inputs primários */
  --ds-background-200: #0a0a0a; /* Fundo geral da página (body), áreas secundárias */
  --ds-background-surface: #121212;

  /* 2. Gray Scale (100 - 1000) */
  --ds-gray-100: #111111;
  --ds-gray-200: #191919;
  --ds-gray-300: #222222;
  --ds-gray-400: #2e2e2e;
  --ds-gray-500: #444444;
  --ds-gray-600: #666666;
  --ds-gray-700: #888888;
  --ds-gray-800: #999999;
  --ds-gray-900: #cccccc;
  --ds-gray-1000: #ededed;

  /* 3. Gray Alpha Scales (Transparências para Hovers e Bordas) */
  --ds-gray-alpha-100: rgba(255, 255, 255, 0.05);
  --ds-gray-alpha-200: rgba(255, 255, 255, 0.08);
  --ds-gray-alpha-300: rgba(255, 255, 255, 0.12);
  --ds-gray-alpha-400: rgba(255, 255, 255, 0.16);
  --ds-gray-alpha-500: rgba(255, 255, 255, 0.24);

  /* 4. Functional Scales (Apenas para gráficos, dots, barras e alertas) */
  --ds-blue-600: #0068d6;
  --ds-blue-700: #0070f3;
  --ds-blue-alpha-200: rgba(0, 112, 243, 0.14);

  --ds-red-600: #c92a2a;
  --ds-red-700: #e5484d;
  --ds-red-alpha-200: rgba(229, 72, 77, 0.14);

  --ds-amber-600: #d97706;
  --ds-amber-700: #f5a623;
  --ds-amber-alpha-200: rgba(245, 166, 35, 0.14);

  --ds-green-600: #008f5d;
  --ds-green-700: #00cc88;
  --ds-green-alpha-200: rgba(0, 204, 136, 0.14);

  --ds-teal-700: #12b5cb;
  --ds-teal-alpha-200: rgba(18, 181, 203, 0.14);

  --ds-purple-700: #8e4ec6;
  --ds-purple-alpha-200: rgba(142, 78, 198, 0.14);

  --ds-pink-700: #e93d82;
  --ds-pink-alpha-200: rgba(233, 61, 130, 0.14);

  /* Semantic Foreground (Typography) */
  --ds-foreground: #ededed;
  --ds-foreground-muted: #888888;
  --ds-foreground-faint: #555555;
  --ds-foreground-contrast: #000000;

  /* Borders & Shadows */
  --ds-border: var(--ds-gray-alpha-300);
  --ds-border-strong: var(--ds-gray-alpha-500);
  --ds-shadow-small: 0 1px 2px rgba(0, 0, 0, 0.6);
  --ds-shadow-medium: 0 12px 36px rgba(0, 0, 0, 0.7);
  --ds-shadow-large: 0 30px 60px rgba(0, 0, 0, 0.9);
  --ds-focus-ring: 0 0 0 2px var(--ds-background-100), 0 0 0 4px var(--ds-blue-700);

  /* Blueprint Grid */
  --ds-grid-line: rgba(255, 255, 255, 0.035);
  --ds-grid-cross: rgba(255, 255, 255, 0.25);
}

/* ==========================================================================
   LIGHT THEME
   ========================================================================== */
:root[data-theme="light"] {
  color-scheme: light;

  --ds-background-100: #ffffff;
  --ds-background-200: #fafafa;
  --ds-background-surface: #f5f5f5;

  --ds-gray-100: #fafafa;
  --ds-gray-200: #f0f0f0;
  --ds-gray-300: #e6e6e6;
  --ds-gray-400: #d6d6d6;
  --ds-gray-500: #a3a3a3;
  --ds-gray-600: #737373;
  --ds-gray-700: #525252;
  --ds-gray-800: #333333;
  --ds-gray-900: #1c1c1c;
  --ds-gray-1000: #111111;

  --ds-gray-alpha-100: rgba(0, 0, 0, 0.03);
  --ds-gray-alpha-200: rgba(0, 0, 0, 0.06);
  --ds-gray-alpha-300: rgba(0, 0, 0, 0.09);
  --ds-gray-alpha-400: rgba(0, 0, 0, 0.14);
  --ds-gray-alpha-500: rgba(0, 0, 0, 0.22);

  --ds-blue-600: #0070f3;
  --ds-blue-700: #095ed5;
  --ds-blue-alpha-200: rgba(0, 112, 243, 0.1);

  --ds-red-600: #ee0000;
  --ds-red-700: #c92a2a;
  --ds-red-alpha-200: rgba(238, 0, 0, 0.1);

  --ds-amber-600: #f5a623;
  --ds-amber-700: #b45309;
  --ds-amber-alpha-200: rgba(245, 166, 35, 0.1);

  --ds-green-600: #008f5d;
  --ds-green-700: #15803d;
  --ds-green-alpha-200: rgba(0, 143, 93, 0.1);

  --ds-teal-700: #0b9bb0;
  --ds-teal-alpha-200: rgba(11, 155, 176, 0.1);

  --ds-purple-700: #7928ca;
  --ds-purple-alpha-200: rgba(121, 40, 202, 0.1);

  --ds-pink-700: #db2777;
  --ds-pink-alpha-200: rgba(219, 39, 119, 0.1);

  --ds-foreground: #111111;
  --ds-foreground-muted: #666666;
  --ds-foreground-faint: #999999;
  --ds-foreground-contrast: #ffffff;

  --ds-border: var(--ds-gray-alpha-300);
  --ds-border-strong: var(--ds-gray-alpha-500);
  --ds-shadow-small: 0 1px 2px rgba(0, 0, 0, 0.05);
  --ds-shadow-medium: 0 12px 30px rgba(0, 0, 0, 0.08);
  --ds-shadow-large: 0 30px 60px rgba(0, 0, 0, 0.12);
  --ds-focus-ring: 0 0 0 2px var(--ds-background-100), 0 0 0 4px var(--ds-blue-700);

  --ds-grid-line: rgba(0, 0, 0, 0.035);
  --ds-grid-cross: rgba(0, 0, 0, 0.2);
}
```

### Papel Arquitetural das Escalas (100 a 1000)

Quando precisar expandir qualquer escala de cor (Gray, Blue, Red, Amber, Green, Teal, Purple, Pink) de `100` a `1000`:

* **Steps 100–300:** Fundos de componentes (`100` Default, `200` Hover, `300` Active).
* **Steps 400–600:** Bordas e divisores (`400` Default, `500` Hover, `600` Active).
* **Steps 700–800:** Elementos de alto contraste, indicadores sólidos e preenchimento de gráficos.
* **Steps 900–1000:** Texto e ícones acessíveis sobre fundos daquela mesma cor (WCAG AA/AAA).

## 3. Escala Tipográfica & Regras Numéricas

| Estilo | Tamanho | Line-Height | Font-Weight | Letter-Spacing | Aplicação |
| ----- | ----- | ----- | ----- | ----- | ----- |
| **Hero Display** | `clamp(34px, 5.6vw, 56px)` | `1.1` | `800` | `-0.04em` | Títulos de Landing Page |
| **Section H2** | `clamp(26px, 3.6vw, 34px)` | `1.2` | `700` | `-0.03em` | Cabeçalhos de seção |
| **Stat Value (KPI)** | `24px` a `28px` | `1.2` | `700` | `-0.03em` | Valores principais nos cards (com `.num`) |
| **Page Title (Topbar)** | `18px` | `1.3` | `600` | `-0.03em` | Título da view ativa no cabeçalho |
| **Card Title** | `14.5px` a `16px` | `1.4` | `600` | `-0.02em` | Títulos internos de cards e modais |
| **Body / UI Base** | `13.5px` a `14px` | `1.5` | `400` / `500` | `-0.01em` | Textos de interface, botões, inputs |
| **Muted / Subtitles** | `12px` a `12.5px` | `1.4` | `400` / `500` | `normal` | Descrições auxiliares, rodapés de cards |
| **Table Header (`th`)** | `11px` | `1.2` | `600` | `0.06em` | `uppercase` (ou `500` normal em tabelas compactas) |

```css
/* Classe utilitária obrigatória para números, moedas, datas e códigos */
.num, .mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
```

## 4. Efeitos Atmosféricos & Superfícies Especiais

### 4.1. Ambient Top Glow

Adicione um brilho radial sutil e fixo no topo da aplicação:

```css
.app-glow {
  position: fixed;
  top: -260px;
  left: 50%;
  transform: translateX(-50%);
  width: 900px;
  height: 500px;
  background: radial-gradient(ellipse at center, rgba(0, 112, 243, 0.07) 0%, transparent 70%);
  filter: blur(80px);
  pointer-events: none;
  z-index: 0;
}
```

### 4.2. Blueprint Grid (Para Landing Pages e Showcases Técnicos)

Fundo quadriculado técnico de `40px x 40px` com marcadores `+` nos cantos:

```css
.blueprint-surface {
  background-image: 
    linear-gradient(to right, var(--ds-grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--ds-grid-line) 1px, transparent 1px);
  background-size: 40px 40px;
}
```

### 4.3. Glassmorphism Header / Sticky Bars

Topbars, navbars e bottom-navs devem usar transparência combinada com `backdrop-filter`:

```css
.glass-bar {
  background: color-mix(in srgb, var(--ds-background-100) 85%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--ds-border);
}
```

## 5. Catálogo de Componentes (Padrões de Código em CSS Puro)

### 5.1. Botões (`.btn`)

* Altura padrão: `34px` (Apps/Dashboards) ou `36px` (Geral).
* Tamanho `.lg`: `42px` a `44px`, padding `0 22px`.
* Tamanho `.sm`: `28px`, padding `0 10px`, font-size `12px`.

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--ds-radius-md);
  border: 1px solid var(--ds-border);
  background: var(--ds-background-100);
  color: var(--ds-foreground);
  transition: all var(--ds-duration-fast) var(--ds-ease);
  white-space: nowrap;
  cursor: pointer;
}
.btn:hover {
  background: var(--ds-gray-alpha-200);
  border-color: var(--ds-foreground-muted);
}
.btn.primary {
  background: var(--ds-foreground);
  border-color: var(--ds-foreground);
  color: var(--ds-foreground-contrast);
  font-weight: 600;
}
.btn.primary:hover {
  opacity: 0.9;
}
.btn.danger {
  color: var(--ds-red-700);
  border-color: rgba(229, 72, 77, 0.3);
  background: var(--ds-red-alpha-200);
}
.btn.danger:hover {
  background: var(--ds-red-700);
  color: #fff;
  border-color: var(--ds-red-700);
}
```

### 5.2. Cards & Spotlight Cards (`.card`)

* Fundo sempre `--ds-background-100` (destacando-se do body `--ds-background-200`).
* Border-radius: `var(--ds-radius-xl)` (`12px`).
* Padding: `22px 24px`.

```css
.card {
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-xl);
  background: var(--ds-background-100);
  padding: 22px 24px;
  position: relative;
  transition: border-color var(--ds-duration-fast);
}
.card:hover {
  border-color: var(--ds-foreground-muted);
}

/* Opcional: Efeito Radial Sheen (Spotlight) ao mover o mouse */
.spotlight-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(400px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), var(--ds-gray-alpha-200), transparent 40%);
  opacity: 0;
  transition: opacity var(--ds-duration-normal);
  pointer-events: none;
}
.spotlight-card:hover::before {
  opacity: 1;
}
```

### 5.3. Badges Neutras com Status Dot (`.badge`)

Em vez de pintar o fundo da badge com cores fortes, mantenha a badge neutra e coloque a cor apenas no `.badge-dot`:

```html
<span class="badge">
  <span class="badge-dot" style="background: var(--ds-green-700);"></span>
  +14.2% mês
</span>
```

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: var(--ds-radius-full);
  line-height: 1;
  border: 1px solid var(--ds-border);
  background: var(--ds-background-200);
  color: var(--ds-foreground);
  white-space: nowrap;
}
.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
```

### 5.4. Inputs, Campos Monetários & Switches

* Inputs em modais/cards usam `background: var(--ds-background-200)` e `border: 1px solid var(--ds-border)`.
* Foco usa borda `--ds-foreground-muted` ou `--ds-blue-700` com `box-shadow: 0 0 0 1px ...`.
* Campos de moeda (`.field-amount`) possuem prefixo `R$` fixo à esquerda em `--font-mono` e `input` com `padding-left: 36px` e classe `.num`.
* Toggle Switch minimalista: `38px x 22px`, fundo desligado `--ds-gray-alpha-300`, fundo ligado `--ds-foreground` com bolinha `--ds-foreground-contrast`.

### 5.5. Tabelas de Dados Limpas

* `border-collapse: collapse; width: 100%;`
* Linhas separadas por `border-bottom: 1px solid var(--ds-border)`, sem borda na última linha (`tr:last-child td { border-bottom: none; }`).
* Hover sutil na linha: `tbody tr:hover td { background: var(--ds-gray-alpha-100); }`.
* Célula principal com ícone em caixa (`30px x 30px`, `border-radius: 6px`, `border: 1px solid var(--ds-border)`).
* Coluna de valor alinhada à direita (`text-align: right; font-weight: 600;`) com classe `.num`.

### 5.6. Visualização de Dados Offline (Charts & Progress Bars em CSS/SVG Puro)

* **Mini Progress Bar (`.mini-bar`):** Altura `4px` ou `5px`, fundo `--ds-gray-alpha-300`, preenchimento com cor semântica da categoria ou de alerta (`>80%` usa `--ds-amber-700`, `>100%` usa `--ds-red-700`).
* **Gráfico de Barras Verticais (`.spend-chart-container`):** Colunas flexíveis com `.spend-bar-track` (`background: var(--ds-gray-alpha-200)`, `max-width: 36px`, `border-radius: 4px`) e `.spend-bar-fill` (`background: var(--ds-gray-500)` por padrão, `--ds-blue-600` na barra `.active` e `--ds-foreground` no `:hover`).
* **Gráfico de Linhas SVG (6 Meses):** Linhas de grade horizontais tracejadas (`stroke-dasharray: 4 4; stroke: var(--ds-border)`), curvas com `stroke-width: 2.5`, preenchimento de área em `linearGradient` com opacidade de `0.15` para `0.01`, pontos (`circle`) com fundo `--ds-background-100` e borda colorida que expandem no hover (`r: 5.5`), exibindo tooltip SVG nativo.
* **Donut Chart CSS:** Construído sem bibliotecas externas usando `conic-gradient(...)` e um círculo interno `.donut-inner` (`width: 66%; height: 66%; background: var(--ds-background-100)`) exibindo o total centralizado com `.num`.

### 5.7. Navegação & Overlays Avançados

* **Theme Switcher Pill:** Container arredondado (`border-radius: 9999px`, `padding: 2px`, `background: var(--ds-background-200)`, `border: 1px solid var(--ds-border)`) com botões circulares de `26px x 26px` para Sol/Lua/Sistema.
* **Command Palette (`cmdk`):** Modal acionado pela tecla `/` ou `⌘K`, centralizado a `15%` do topo (`width: 560px`, `border-radius: 12px`, `border: 1px solid var(--ds-border-strong)`, `box-shadow: var(--ds-shadow-large)`), com busca instantânea e atalhos `<kbd>`.
* **Sheets / Modais:** No Desktop, centralizados (`width: 440px` a `520px`, `border-radius: 16px`). No Mobile (`<= 880px`), convertem-se automaticamente em **Bottom Sheets** (`bottom: 0`, `border-radius: 16px 16px 0 0`, animação `translateY(100%)` -> `translateY(0)`).

## 6. Arquitetura de Layout e Uso em React (Sem Dependências)

### 6.1. Estrutura de Aplicação (App Shell)

1. **Desktop (`> 880px`):**
   * `.app`: `display: flex; min-height: 100vh;`
   * `.sidebar`: `width: 250px; position: sticky; top: 0; height: 100vh; background: var(--ds-background-100); border-right: 1px solid var(--ds-border); padding: 20px 16px;`
   * `.main`: `flex: 1; min-width: 0; display: flex; flex-direction: column;`
   * `.topbar`: `position: sticky; top: 0; padding: 16px 36px; z-index: 20;` (com `backdrop-filter: blur(12px)`).
   * `.view-container`: `padding: 32px 36px 80px; max-width: 1240px; width: 100%; margin: 0 auto;`
   * Grids de Dashboard: `.stat-grid` (`grid-template-columns: 1.35fr 1fr 1fr; gap: 16px;`) e `.grid-2` (`grid-template-columns: 1.55fr 1fr; gap: 16px;`).

2. **Mobile (`<= 880px`):**
   * Oculta `.sidebar` e elementos `.desktop-only`.
   * Grilhas (`.stat-grid`, `.grid-2`, `.cat-grid`) colapsam para `grid-template-columns: 1fr`.
   * Exibe `.bottom-nav` fixa no rodapé com `backdrop-filter: blur(12px)`, `padding-bottom: max(12px, env(safe-area-inset-bottom))`, 4 abas principais e um botão central elevado (`.bnav-fab` com `margin-top: -20px`).

### 6.2. Sistema de Ícones SVG Offline

* Nunca instale pacotes externos de ícones quando puder embutir um sprite `<svg style="display:none"><symbol id="i-nome" viewBox="0 0 24 24">...</symbol></svg>` e instanciar com `<svg class="icon"><use href="#i-nome"/></svg>`.
* Estilo padrão do `.icon`:

```css
.icon {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: none;
}
```

### 6.3. Padrão de Componente em React (Usando o CSS Puro da Skill)

Ao criar componentes React (`.jsx` / `.tsx`), importe o CSS global e aplique as classes diretamente via `className`, usando `style` inline apenas para valores dinâmicos (como porcentagens ou cores de variáveis CSS):

```jsx
// Exemplo de Componente React 100% compatível com o CSS Puro
export function StatCard({ label, badgeText, dotColor = 'var(--ds-green-700)', value, foot }) {
  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: '8px' }}>
        <span className="stat-label" style={{ margin: 0 }}>{label}</span>
        <span className="badge">
          <span className="badge-dot" style={{ background: dotColor }} />
          {badgeText}
        </span>
      </div>
      <p className="stat-value num">{value}</p>
      <p className="stat-foot">{foot}</p>
    </div>
  );
}
```

## 7. Checklist de Validação antes de Entregar Código

Sempre que finalizar uma interface utilizando esta skill, verifique:

* [ ] O código está **100% livre de Tailwind** ou frameworks externos e roda perfeitamente offline?
* [ ] Todos os números, preços (`R$`), datas e porcentagens possuem a classe `.num` (`tabular-nums`)?
* [ ] Os textos estão 100% neutros (`--ds-foreground` e `--ds-foreground-muted`), sem títulos coloridos?
* [ ] Os botões primários são monocromáticos (fundo `--ds-foreground`, texto `--ds-foreground-contrast`)?
* [ ] As cores semânticas estão restritas a dots, gráficos, barras de progresso e ícones de alerta?
* [ ] Ambos os temas (`data-theme="dark"` e `data-theme="light"`) estão configurados e funcionais?
* [ ] No mobile (`<= 880px`), os modais viram *bottom sheets* e a sidebar dá lugar à *bottom-nav*?
