import type {NextConfig} from "next";
const config:NextConfig={
 output:"standalone",
 poweredByHeader:false,
 serverExternalPackages:[],
 async headers(){return [{source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Referrer-Policy",value:"same-origin"}]}];}
};
if (process.env.NEXT_WEBPACK_MEMORY_CACHE === "1") {
 config.webpack = (webpackConfig, {dev}) => {
  if (dev) webpackConfig.cache = {type: "memory"};
  return webpackConfig;
 };
}
export default config;
