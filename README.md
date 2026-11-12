# Load Image

一个 Obsidian 插件：**控制 Ctrl/Cmd+V 粘贴图片时的存放位置**。

Obsidian 默认会把粘贴的图片存到附件目录，或者丢到笔记同级目录，无法按目录分别管理。本插件让粘贴图片的落点完全可控——把图片存到笔记旁边的 `assets`，或统一的 `assets/images`，或任意仓库内路径，文件夹不存在时自动创建。

## 功能

- **可配置的粘贴目录**：留空 = 笔记同级；`./`、`../` = 相对笔记；其他 = 相对仓库根目录。
- **自动创建目录**：多级目录逐级补齐，无需手动建文件夹。
- **不覆盖已有文件**：同名时自动追加 `-1`、`-2`。
- **一次粘贴多张**：批量保存并在光标处逐行插入。
- **两种链接格式**：Markdown 相对路径 `![](assets/a.png)`，或 Wiki 嵌入 `![[assets/a.png]]`。
- **图片名模板**：默认留空使用剪贴板原文件名；可用 `{name}` `{timestamp}` `{date}` `{time}` `{note}` 自定义。
- **不影响其他粘贴**：只有剪贴板里含图片时才接管，文本、文件粘贴保持原生行为。

## 目录规则

设置项「粘贴图片的存放目录」的取值语义：

| 设置值 | 实际保存位置（示例笔记 `notes/daily/2026-11-12.md`） |
| --- | --- |
| 留空 | `notes/daily/`（笔记同级） |
| `./assets`（默认） | `notes/daily/assets/` |
| `../assets` | `notes/assets/` |
| `./img/pasted` | `notes/daily/img/pasted/` |
| `/assets` | `assets/`（仓库根目录） |
| `assets/images` | `assets/images/`（仓库根目录） |

规则说明：

- 以 `./` 或 `../` 开头 → 相对**当前笔记所在目录**解析。
- 以 `/` 开头或不带前缀 → 相对**Obsidian 仓库根目录**解析。
- 因此想放在笔记同级某目录下，必须写 `./xxx`；直接写 `xxx` 会落在仓库根目录。这样两种模式不会混淆。
- 路径不能越过仓库根目录（如从根目录写 `../x` 会报错）。

## 安装

### 手动安装

1. 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放到 `<你的仓库>/.obsidian/plugins/load-image/`。
3. 在 Obsidian「设置 → 第三方插件」中启用 **Load Image**。

### 从源码构建

```bash
npm install
npm run build      # 生成 main.js
npm run dev        # 监听模式
```

## 设置项

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 粘贴图片的存放目录 | `./assets` | 见上方目录规则；设置页下方以固定示例 `a/b/c.md` 实时预览落点 |
| 插入链接格式 | Markdown | `![](assets/a.png)` 或 `![[assets/a.png]]` |
| 图片名模板 | 留空 | 留空 = 使用剪贴板原文件名；可填 `{name}` `{timestamp}` `{date}` `{time}` `{note}`，非法字符自动替换为 `-`，重名自动追加 `-1` |
| 保存后显示提示 | 关闭 | 保存成功后在右上角提示 |

## 命令

- **从剪贴板粘贴图片** —— 供快捷键绑定使用。正常 Ctrl/Cmd+V 已自动生效，此命令用于 `editor-paste` 事件未触发的边缘场景。

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest，63 个单元测试
npm run smoke       # 加载真实 main.js，模拟 Ctrl+V 全链路
npm run verify      # 以上全部 + 生产构建
```

代码分层：

- `main.ts` —— 控制器：注册事件、设置页、把 Obsidian API 适配成 `VaultPort`。
- `src/paths.ts` —— 纯函数：路径解析、唯一命名、链接生成（无 Obsidian 依赖，易测）。
- `src/saver.ts` —— 服务层：目录创建、写入、链接拼装，只依赖 `VaultPort` 接口。
- `src/settings.ts` —— 设置契约与容错校验。

## License

MIT