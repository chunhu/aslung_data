export const HOMEPAGE_OPTIONS=[
  {key:'hero_visual',default:true,zh:'首頁主視覺示意圖',en:'Hero illustration',description:'首頁右側的觀測曲線與資料流程示意。',descriptionEn:'The observation chart and workflow illustration beside the introduction.'},
  {key:'hero_device_label',default:false,zh:'示意圖上的設備名稱標示',en:'Device names on the illustration',description:'顯示 ASLUNG · LI-COR / HOBO；目前預設隱藏。',descriptionEn:'Show ASLUNG · LI-COR / HOBO. Hidden by default.'},
  {key:'data_sources',default:true,zh:'資料來源簡介列',en:'Data sources strip',description:'顯示 ASLUNG、LI-COR / HOBO 與環境量測資料簡介。',descriptionEn:'The strip introducing supported observation data sources.'},
  {key:'features',default:true,zh:'功能介紹：讓研究工作，更有條理',en:'Feature overview',description:'觀測資料整合、設備追蹤與校正、依授權協作共享三張介紹卡片。',descriptionEn:'The three cards describing data integration, tracking/calibration and sharing.'},
  {key:'public_posts',default:true,zh:'首頁公開消息與文章',en:'Public posts on the homepage',description:'首頁的公開內容摘要列表。隱藏此區不會取消文章的公開權限。',descriptionEn:'The public post summaries. Hiding this section does not make the posts private.'},
  {key:'join',default:true,zh:'開始使用平台／申請流程',en:'Getting started and application steps',description:'開始使用平台及申請、驗證、授權三步驟。隱藏此區不會停止會員註冊。',descriptionEn:'The application, verification and access steps. Hiding this section does not disable registration.'},
];
export const DEFAULT_HOMEPAGE_SETTINGS=Object.fromEntries(HOMEPAGE_OPTIONS.map(option=>[option.key,option.default]));
