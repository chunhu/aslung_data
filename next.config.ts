import type {NextConfig} from "next";
const config:NextConfig={
 output:"standalone",
 poweredByHeader:false,
 experimental:{cpus:1,webpackMemoryOptimizations:true},
 // The standalone image also runs the unbundled calibration worker.
 // Keep database/S3 dependencies available to native Node.js worker imports.
 serverExternalPackages:["mysql2","@aws-sdk/client-s3"],
 async headers(){return [
  {source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"same-origin"}]},
  // Only the static manuals may appear in the site's own documentation reader.
  {source:"/docs/:path*.html",headers:[{key:"X-Frame-Options",value:"SAMEORIGIN"}]}
 ];}
};
if (process.env.NEXT_WEBPACK_MEMORY_CACHE === "1") {
 config.webpack = (webpackConfig, {dev}) => {
  if (dev) webpackConfig.cache = {type: "memory"};
  return webpackConfig;
 };
}
export default config;
