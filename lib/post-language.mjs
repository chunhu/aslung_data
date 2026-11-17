// Select a complete translation; retain the original content for legacy posts.
export function displayPost(post,english=false){
 post={...post,...(Object.hasOwn(post,'display_author')?{author_name:english?(post.display_author_en??'Editorial team'):post.display_author}:{})};
 if(!english||!post.title_en?.trim()||('body' in post&&!post.body_en?.trim()))return {...post,translationFallback:!!english};
 return {...post,title:post.title_en,summary:post.summary_en||'',...('body' in post?{body:post.body_en,body_json:post.body_json_en||null}:{}),translationFallback:false};
}
