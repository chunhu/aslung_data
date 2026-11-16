const messages={
  "操作失敗。": "The operation failed. Please try again.",
  "驗證碼已寄出，請於 10 分鐘內輸入；驗證後才會送交管理員審核。": "A verification code has been sent. Enter it within 10 minutes to submit your request for administrator review.",
  "申請已送交管理員審核。核准後會寄送下載連結至您的 Email。": "Your request has been submitted for administrator review. A download link will be emailed to you after approval.",
  "Email 驗證完成。": "Email verified.",
  "已記錄外部連結轉址；無法確認外部網站的下載結果。": "The external redirect has been recorded. Download completion on the external website cannot be confirmed.",
  "檔案已傳送給瀏覽器，請確認瀏覽器的下載結果。": "The file has been sent to your browser. Check your browser for the download result.",
  "請重新取得驗證碼。": "Please request a new verification code.",
  "Email 格式不正確。": "Enter a valid email address.",
  "檔案不存在或已移除。": "The file does not exist or has been removed.",
  "下載連結無效或已到期。": "The download link is invalid or has expired.",
  "下載連結已停用、到期或達下載次數上限。": "The download link has been disabled, has expired or has reached its download limit.",
  "要求過於頻繁，請稍後再試。": "Too many requests. Please try again later.",
  "頁碼不正確。": "Invalid page number.",
  "驗證碼已失效，請重新取得。": "The verification code has expired or is no longer valid. Request a new code.",
  "驗證碼不正確。": "Incorrect verification code.",
  "此檔案目前不接受公開申請。": "This file is not currently accepting public requests.",
  "申請無效。": "Invalid request.",
  "申請已送出或失效。": "This request has already been submitted or is no longer valid.",
  "此檔案已停止公開申請。": "Public requests for this file have been closed.",
  "請先驗證 Email。": "Please verify your email first.",
  "驗證已到期，請重新取得驗證碼。": "Your verification session has expired. Request a new code.",
  "下載次數已用完。": "No downloads remain.",
  "驗證信寄送失敗，請稍後重新申請。": "The verification email could not be sent. Please submit your request again later.",
  "驗證信寄送失敗，請稍後再試。": "The verification email could not be sent. Please try again later.",
  "檔案實體不存在。": "The file is unavailable. Please contact the administrator.",
  "無效操作。": "Invalid operation.",
  "操作格式不正確。": "Invalid request format.",
  "內容超過允許大小。": "The request exceeds the permitted size.",
  "JSON 內容格式不正確。": "Invalid request format.",
  "請填寫有效的姓名。": "Enter a valid name.",
  "請填寫有效的單位。": "Enter a valid organization.",
  "請填寫有效的用途。": "Enter a valid intended use.",
  "請填寫有效的Email。": "Enter a valid email address.",
  "請填寫有效的檔案編號。": "Enter a valid file ID."
};
export function guestFileMessage(value,english=false){
 const text=String(value||'');if(!english)return text;
 if(messages[text])return messages[text];
 if(text.startsWith('已寄送至 '))return 'Verification code sent to '+text.slice(5);
 // Existing bilingual service errors already contain an English version.
 const bilingual=text.match(/ \/ ([A-Za-z][\s\S]*)$/);if(bilingual)return bilingual[1];
 return /[\u3400-\u9fff]/.test(text)?'Unable to complete this operation. Please try again later or contact the administrator.':text;
}
