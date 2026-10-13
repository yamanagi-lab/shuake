# P5R主明文本收录（网站）

P5R 明智 coop 剧情的日文原文和中文参考译文对照网站。纯静态页面，没有用到任何框架或第三方库，可以直接放到 GitHub Pages 上运行。

## 文件结构

```
index.html          页面骨架（封面、摘要、进站须知等固定文字也在这里）
assets/style.css    样式
assets/app.js       页面逻辑：读取正文、对照排版、搜索、阅读设置、过场动画
assets/crest*.png   校徽（去掉了白底的透明图）
content/toc.txt     目录：章节顺序、日期、地点、对应的正文文件
content/*.txt       各章正文，写法见 content/README.md
.nojekyll           让 GitHub Pages 原样发布所有文件
```

## 本地预览

浏览器不允许直接双击打开的页面读取 `content` 文件夹，需要先在这个文件夹里启动一个本地服务器：

```bash
python3 -m http.server 8642
```

然后用浏览器打开 http://localhost:8642 。

## 发布到 GitHub Pages

1. 在 GitHub 新建一个仓库，把这个文件夹里的全部文件上传进去（`.nojekyll` 也要传）。
2. 打开仓库的 Settings → Pages，Source 选择 “Deploy from a branch”，分支选 `main`，目录选 `/ (root)`，保存。
3. 等一两分钟，页面上方会给出网址，形如 `https://用户名.github.io/仓库名/`。

## 修改内容

- 改正文：直接编辑 `content` 里对应的 `.txt`，在 GitHub 网页上编辑后提交即可。
- 加新章节：新建一个 `.txt`，然后在 `content/toc.txt` 对应那一行的最后填上文件名。
- 改了 `style.css` 或 `app.js` 之后，把 `index.html` 里 `?v=` 后面的数字加一，读者的浏览器才会加载新版本。

## 关于搜索引擎

每个页面都带有 `noindex` 标记，正规搜索引擎不会收录。GitHub Pages 不支持在仓库子路径下放 `robots.txt`，所以这里没有放。
