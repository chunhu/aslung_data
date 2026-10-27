# 最新消息與文章發布 / News and articles

## 操作方式

1. 登入網站，在側邊欄選擇「最新消息」或「文章專區」。所有已登入且有效的會員，包括檢視會員，均可閱讀已發布內容；未登入訪客不能閱讀。
2. 系統管理員 admin 可按「新增」，填寫標題、選填摘要與內文，可勾選置頂。內文保留換行與段落，http/https 網址可點擊；不執行 HTML 或 JavaScript。
3. 按「預覽文章」確認顯示，再按「儲存草稿」或「儲存並發布」。空白摘要自動擷取內文前 160 字。草稿僅供管理員在「管理發布」模式閱讀。
4. 在「管理發布」搜尋內容、篩選草稿／已發布／已下架，點「編輯／發布設定」修改內容或下架。下架保留紀錄，可重新發布；將已發布內容儲存為草稿也會停止對會員顯示。
5. 閱讀端以置頂優先，再依首次發布時間由新至舊排列，每頁 20 篇。搜尋涵蓋標題、摘要及內文；點標題閱讀全文。時間依網站選定時區顯示。

標題最多 160 字、摘要 500 字、內文 60,000 字。發布不自動寄 Email。若兩位管理員同時編輯，系統會拒絕較舊版本的儲存，避免覆蓋他人的更新；請重新載入最新內容後再整合。

## 保存與權限

貼文與發布操作紀錄保存在目前共用的 SQLite，包含於既有 SQLite 備份，不需要額外的 S3 權限。首次使用會建立 `site_posts` 與 `site_post_events` 表。保留原作者、首次發布時間、最後更新者與版本。此版本提供下架，未提供永久刪除或完整歷史版本還原。

`GET /api/posts?kind=news` 或 `kind=article` 回傳已發布清單，支援 `q`、`page`。`GET /api/posts?id=<ID>` 讀取全文。只有 admin 能使用 `manage=1` 查看草稿及下架內容，或 POST 儲存內容；寫入還需符合目前 APP_ORIGIN。會員不能藉由猜測 ID 讀取草稿。

## English

Signed-in active members can read published news and articles from the sidebar. Only system administrators can create, edit, pin, publish or archive posts. Select **New post**, enter a title, optional summary and body, preview it, then save a draft or publish. A blank summary is generated from the first 160 body characters. Line breaks are preserved and HTTP/HTTPS URLs become links; HTML and scripts are treated as text.

**Manage posts** lists drafts, published posts and archived posts, with status and full-text search. Archiving hides a post from members while retaining it for later republication. Saving a published post as a draft also hides it. Pinned posts appear first, followed by most recently first-published posts, 20 per page. Publication does not send Email automatically.

Limits are 160 characters for titles, 500 for summaries and 60,000 for bodies. Version checks reject stale concurrent edits. Data and action records are stored in the existing SQLite database and included in its backups; no additional S3 permission is required. Permanent deletion and full historical version restoration are not included.

The API requires authentication. Ordinary members can only list/read published posts. `manage=1` and POST writes require admin; writes must also pass the site's Origin check.
