import type {NextConfig} from "next";
const config:NextConfig={
 output:"standalone",
 poweredByHeader:false,
 // The standalone image also runs the unbundled calibration worker.
 // Keep mysql2 and its dependencies available to native Node.js imports.
 serverExternalPackages:["mysql2"],
 async headers(){return [{source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"same-origin"}]}];}
};
if (process.env.NEXT_WEBPACK_MEMORY_CACHE === "1") {
 config.webpack = (webpackConfig, {dev}) => {
  if (dev) webpackConfig.cache = {type: "memory"};
  return webpackConfig;
 };
}
export default config;
