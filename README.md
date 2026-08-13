# Mayfly Mod Manager

Electron + Vue 3 + TypeScript 写的本地 Mod 管理器，功能参考 Gloss Mod Manager，当前只保留本地 Mod 管理和 NexusMods 源。

## 常用命令

```powershell
npm install
npm run dev
npm run typecheck
npm run build
npm run dist
```

## 当前范围

- 游戏库：支持预设游戏、自定义游戏、Steam 定位、启动游戏。
- 本地 Mod：支持文件夹、单文件、zip、7z、rar、`.gmm` 导入。
- 安装卸载：按 adapter 规则安装，记录部署文件，卸载时优先按记录删除。
- NexusMods：API Key 校验、列表、详情、文件下载、筛选。
- 下载：Nexus 下载、自定义 URL 下载、任务记录。
- 备份：游戏目录 zip 备份、恢复、删除、查看内容。

## 暂不做

- 3DM/Gloss Mod 站。
- Thunderstore、mod.io、CurseForge、GameBanana。
- AI、MCP、Skills。
