---
name: TradeOS
description: 中文个人财富与交易管理的专业金融终端
colors:
  bg: "#101419"
  panel: "#171d24"
  raised: "#1d252e"
  line: "#2b3541"
  text: "#e9eef4"
  muted: "#a1aebe"
  accent: "#64d4b1"
  danger: "#ff929a"
  positive: "#64d4b1"
  input: "#11171e"
  light-bg: "#f3f5f7"
  light-panel: "#fff"
  light-raised: "#eef2f4"
  light-line: "#d5dde3"
  light-text: "#182936"
  light-muted: "#526575"
  light-accent: "#126c55"
  light-danger: "#b53443"
  light-positive: "#126c55"
  light-input: "#f9fbfc"
  chart-2: "#6f9fd8"
  chart-3: "#d4b477"
  chart-4: "#aa94d5"
  chart-5: "#e68791"
  light-chart-1: "#14795c"
  light-chart-2: "#376d9e"
  light-chart-3: "#876a29"
  light-chart-4: "#7150a6"
  light-chart-5: "#a73d50"
typography:
  display:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\""
  headline:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "-0.025em"
  title:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.6
  body:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  button:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.6
  table-header:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.6
  nav-group:
    fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "0.08em"
  numeric:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontFeature: "\"tnum\""
rounded:
  badge: "4px"
  field: "5px"
  action: "6px"
  panel: "12px"
spacing:
  step-8: "8px"
  step-10: "10px"
  step-12: "12px"
  step-15: "15px"
  step-16: "16px"
  step-20: "20px"
  step-22: "22px"
  step-24: "24px"
  step-32: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    typography: "{typography.button}"
    rounded: "{rounded.action}"
    padding: "8px 13px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.action}"
    padding: "8px 13px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.action}"
    padding: "7px"
  input:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "9px 10px"
  navigation:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    padding: "8px 10px"
  navigation-active:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    padding: "8px 10px"
  badge:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "22px"
  metric:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.display}"
    padding: "22px"
  data-table:
    textColor: "{colors.text}"
    typography: "{typography.label}"
  empty-state:
    textColor: "{colors.muted}"
    padding: "50px 20px"
---

# Design System: TradeOS

## Overview

**Creative North Star: "专业金融终端"**

TradeOS 的视觉方向沿用用户已确认的专业金融终端：中文操作、本地单用户、默认深色并可切浅色、高信息密度，优先业务准确性，不过度美化。界面以总资产与风险、资产明细、资金流水和交易记录组织工作，依靠标题、分隔线、表格与有限的强调色表达层次。

系统采用可离线的中文系统字体、等宽数字、平整面板与清晰键盘焦点。主题更换只改变可读性与表面色，不改变金融语义；模拟回测与真实账本的隔离须在相关页面明确表达。本文记录已实现的设计系统；视觉证据仅覆盖财富主页的桌面深色、手机深色和桌面浅色三个视口，不能据此声称全应用完成视觉认证。

**Key Characteristics:**

- 中文系统字体，金额保留币种，数值对齐稳定。
- 深浅两套语义色，正收益、负收益、零值与缺失值明确区分。
- 紧凑导航、指标分格、图表与明细表，信息优先。
- 响应式重排与表格横向滚动，保留完整金融字段。

## Colors

炭灰与深石板形成默认终端表面，浅色主题采用灰白底与白色面板；有限的薄荷强调色承担操作、选中项与正收益，珊瑚风险色承担负收益与错误。精确值以本文件 frontmatter 为准，CSS 来源为 `app/globals.css`。

### Primary

- **薄荷强调色**（`accent`）：主按钮、选中导航、输入光标、文本选择、焦点与可点击资产提示。
- **收益色**（`positive`）：与强调色共用当前色值，但保留独立的金融语义。
- **浅色主题强调与收益色**（`light-accent` / `light-positive`）：改为较深的绿色，保持灰白表面上的可读性。

### Neutral

- **工作台底色**（`bg` / `light-bg`）：页面全局背景与主按钮文字。
- **面板色**（`panel` / `light-panel`）：导航、指标容器、表单、图表和表格所在面板。
- **抬升层**（`raised` / `light-raised`）：表头、行悬停、导航悬停和选中项、徽标与通知条。
- **边界色**（`line` / `light-line`）：导航分隔、表格行、面板边框和滚动条。
- **正文色**（`text` / `light-text`）与**辅助文字色**（`muted` / `light-muted`）：分别承载业务值与标签、说明、来源时间。
- **输入底色**（`input` / `light-input`）：输入、选择框与搜索框。

### 金融语义与图表

- **风险色**（`danger` / `light-danger`）：负盈亏与错误，配合正负号和错误文字，不以颜色单独传达结果。
- **图表序列色**：深色顺序为 `accent`、`chart-2` 至 `chart-5`；浅色顺序为 `light-chart-1` 至 `light-chart-5`。这些色用于区分序列或资产分类，不自动代表盈亏。
- ECharts 的坐标文字、图例文字与分隔线读取当前主题变量；监听根节点 `data-theme` 变化并更新系列色。此行为已在 `components/charts.tsx` 实现，不能自动推广到其他图表组件。

**The Financial Meaning Rule.** 正数使用收益色，负数使用风险色，零值和缺失值保持中性色；缺失金额显示“数据不足”，不得伪装成零。

## Typography

**Display / Body Font:** PingFang SC、Microsoft YaHei、system-ui、sans-serif，使用离线系统字体。

**Numeric Font:** ui-monospace、SFMono-Regular、monospace，用于明细数量与标记为数值的字段。关键指标仍使用中文系统字体并启用等宽数字。

**Character:** 中文业务文字保持紧凑，金额和百分比承担视觉主层级；不引入展示衬线字体或营销标题样式。

### Hierarchy

- **Display**：主指标采用 frontmatter 的 `display`；手机以及次级指标降为（21px），保留（1.3）行高与（600）字重。
- **Headline**：页面标题采用 `headline`；手机降为（24px），标题使用平衡换行。
- **Title**：面板标题采用 `title`；下一级标题为（14px），维持正文行高。
- **Body**：正文采用 `body`，默认行高（1.6）。
- **Label**：导航、表格内容、表单标签、说明采用 `label`；指标备注和本地状态使用（11px），徽标、明细入口提示与页脚使用（10px）。
- **Table Header / Nav Group**：分别采用 `table-header` 与 `nav-group`；英语分组标签是当前导航内容，不意味着全部中文标题需要英文或全大写。

**The Numeric Alignment Rule.** 指标使用 tabular-nums；明细中的数量与关键金额使用等宽数字样式，金额保留计价币种。

## Layout

桌面为固定左导航（228px）与工作区；顶部栏高度（62px），主内容最大宽度（1700px），内容内边距（30px 32px）。页面标题与主要操作同行排列，页内面板按（20px）间距纵向组织；主指标分成四列，六项次级指标分成三列。指标用共享外边框与内分隔线，避免重复的独立卡片包裹。

图表组合采用（1.8fr / 1fr）双列，次列最小（280px）；等宽双列与三列表单复用（20px）和（15px）间距。面板与主指标通常内置（22px）留白，表格维持紧凑行距。

- **不超过 1100px**：导航收窄到（200px），主内容留白变为（24px），主指标变为两列，图表组合变为单列，表单变为两列。次级指标仍为三列，直到手机断点。
- **不超过 720px**：导航默认隐藏，由顶部菜单展开（228px）侧栏；主区取消左偏移，内容留白为（22px 16px）；页面标题与操作纵向排列，指标与次级指标均为两列，等宽双列与表单变为单列，面板内边距降为（16px）。
- **数据表**：保持不换行的金融字段，容器横向滚动。溢出时通过 ResizeObserver 显示“左右滑动查看完整表格”或上下文提示；滚动区域可被键盘聚焦，不削减手机字段。

表格每页（15条）记录，搜索框最大宽度（260px）。指标金额允许必要的换行以避免突破手机容器。

## Elevation & Depth

系统无装饰阴影。深度来自工作台底色、面板色、抬升层与单像素边框；导航保持固定位置，手机展开导航通过层级（z-index: 40）位于内容之上。按钮只使用背景过渡（0.15s ease-out）与悬停亮度反馈；减少动态效果偏好下关闭过渡和动画。

**The Flat Surface Rule.** 以背景、面板、抬升层和边框区分结构，不增加装饰阴影、纹理或大面积渐变。

## Shapes

面板和指标共享大圆角 `panel`；操作和导航采用紧凑圆角 `action`；字段与品牌标记采用 `field`；徽标和进度条采用 `badge`。边界以（1px）线条呈现，进度条与指标容器裁切到圆角边界，本地连接点为小圆点。矩形表格保持完整列对齐，不为每行增加独立圆角容器。

## Components

### Buttons

紧凑、直接，明确表达保存、切换和查看等业务动作。

- 三种既有变体为主按钮、描边按钮、幽灵按钮，分别对应 `button-primary`、`button-outline`、`button-ghost`。
- 主按钮用强调色底与工作台底色文字；描边按钮透明底与边界色；幽灵按钮透明底与辅助文字。
- 悬停亮度提高至（1.12）；按钮禁用透明度（0.45），显示不可操作光标。保存期间按钮禁用并显示“保存中…”。
- 统一键盘焦点为强调色（2px）轮廓，普通操作轮廓外移（4px）。

### Chips / Status Badges

中性的小型状态容器，以 `badge` 表达流水类型与估值状态；使用抬升层、边界色、（10px）文字和紧凑留白。有效、过期、缺失由文字说明，当前徽标没有独立交互或盈亏色变体。

### Cards / Containers

面板集中容纳一组业务信息，用 `panel` 的表面与圆角，边界（1px），通常留白（22px），手机降为（16px）。指标容器共用同一边框并内部分格；不使用阴影抬升。

### Inputs / Fields

`input` 使用独立输入底色、正文色、单像素边界与字段圆角；最小高度（38px），多行文本最小高度（90px）。真实 label 包裹字段，默认必填、可选字段显式声明；搜索框提供屏幕阅读器标签。错误在提交动作旁以风险色和 `role="alert"` 呈现，并非所有字段都有单独错误边框。复选框为（18px），随主题使用强调色。

### Navigation

左侧按财富、交易、财务自由及系统分组；链接采用（12px）文字、（17px）图标与（8px 10px）留白。默认为辅助文字，悬停为正文色与抬升层，当前路径为强调色与抬升层。手机点击链接后关闭侧栏；主题按钮保留可访问标签，深浅选择保存在本地。

### Metrics and Financial Trace

汇总金额使用 `metric` 层级，并为已配置链接的指标保留“查看明细”提示与访问名称。总资产、净资产和可投资净资产进入资产明细；账户资产中的名称和“查看流水”链接携带 `accountId` 与 `assetId`。流水页明确展示当前筛选并提供清除筛选入口。

追踪机制为“总资产与风险 → 资产明细 → 保留账户/资产上下文的资金流水 → 关联成交”。目前最后一步通过流水行的成交标识表达，未实现成交标识点击跳转；该事实不能在后续页面设计中被误报成完成的导航。

### Data Tables and Charts

表头采用抬升层，内容使用单像素行分隔；悬停整行反馈，可排序列使用按钮和方向箭头，搜索与记录数位于表前，分页位于表后。横滑区使用可访问区域名称与（2px）焦点外移。

ECharts 画布高度（300px），趋势线宽度（2px）且不常显点，分布图为（48% / 72%）内外半径的环图。图例在底部，使用主题语义文字与边界；容器尺寸变更触发图表重排，缺失趋势点不应伪造为零值。

### Financial Empty States and Notices

空状态采用中性辅助文字、居中留白（50px 20px）与明确下一步。没有快照时说明创建平台账户、录入余额、更新价格、保存快照的路径，并给出业务入口；图表数据不足时说明需要保存估值或录入记录。估值不完整通知明确“已知估值小计”不能代表完整净资产。真实账本和模拟回测使用清晰页面标题与隔离说明，保留其业务上下文。

## Do's and Don'ts

### Do:

- **Do** 沿用中文系统字体、既有数值层级与完整币种标记。
- **Do** 为可点击汇总保留“查看明细”，从资产进入流水时保留账户与资产筛选上下文。
- **Do** 将估值缺失、过期、数据不足与业务空状态写成可理解的文字；同时保留开始操作的入口。
- **Do** 保留浅色主题、清晰键盘焦点、减少动态效果设置与手机表格横滑提示。
- **Do** 在模拟回测页面明确显示与真实账本隔离的说明。

### Don't:

- **Don't** 用装饰性图像、大面积渐变或悬浮阴影挤占业务信息。
- **Don't** 将零盈亏染成正收益或负收益，也不要把缺失金额显示为零。
- **Don't** 为适配手机隐藏关键金额、币种、估值状态或来源时间；使用可聚焦横向滚动区。
- **Don't** 将当前显示的关联成交标识描述为已经实现的成交跳转链接。
- **Don't** 把财富主页三个截图的核对结果扩大为全应用视觉认证。

实现核对来源：`app/globals.css`、`components/shell.tsx`、`components/ui/button.tsx`、`components/wealth-view.tsx`、`components/table.tsx`、`components/charts.tsx`、`components/form.tsx` 和 `lib/utils.ts`。视觉核对来源：`.impeccable/review/desktop.png`（1433×2754）、`mobile.png`（390×3745）、`light.png`（1433×2754），均为财富主页；本次文档记录不扩大已有审查范围。
