// Existing endpoint unit fixtures isolate business rules. End-to-end HTTP
// tests and activity-security.test.mjs exercise the real audit implementation.
export const auditOperation=(_request,handler)=>handler();
export const setActivityAction=()=>{};
export const recordRequestEvent=()=>{};
export const checkLoginRate=()=>{};
