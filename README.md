# ZHOUXU.TOP · HOME OS

ZhouXu 的个人主页 —— 一座可以漫游的三维档案终端。

**在线访问 → [zhouxu.top](https://zhouxu.top)**

打开网页，进入一间悬浮着 40 份档案的资料室。左右切换栏目，上下选择档案，回车读取全文——我的简介、作品、项目与联系方式都以档案的形式编目其中。

## 栏目

| 栏目 | 内容 |
| --- | --- |
| 个人简介 | 关于我、关于本站 |
| 我的作品 | 更新中...敬请期待 |
| 项目经历 | 本站的建设记录，更多项目陆续归档 |
| 联系方式 | 电子邮箱：zhouxu_2007@163.com |
| 更多内容 | 更新中...敬请期待 |

## 操作方式

- `←` `→` 切换栏目，`↑` `↓` 选择档案，`Enter` 读取
- `/` 打开档案检索，`Esc` 返回
- 档案详情页支持 360° 查看文档模型、导出对应 txt 文件、收藏档案

## 本地开发

```bash
npm install
npm run dev      # 本地预览
npm run build    # 构建到 dist/
```

## 更新网站内容

所有档案文案集中在 [`content/archives.json`](content/archives.json)，改完重新构建即可：

- `records`：40 份档案（每栏 8 份），字段包括标题、分类、摘要、详细内容等
- `categories` / `columns`：五个栏目的名称与排列顺序
- 构建时会自动校验数据，并重新生成 `public/archives/` 下可下载的 txt 文件

## 部署

静态站点，构建产物为 `dist/`。当前通过 Cloudflare Pages 自动部署：推送到 `main` 分支即触发重新构建。

- Build command: `npm run build`
- Output directory: `dist`

## 技术

Three.js · TypeScript · Vite · MiSans 字体

## 致谢与许可

本站基于 [RhineLabUI](https://github.com/LBEILC/RhineLabUI) 改造（MIT License），感谢原作者开源。原项目的署名与许可文件保留于仓库中。
