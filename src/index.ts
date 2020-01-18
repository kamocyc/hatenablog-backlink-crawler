import nfetch from 'node-fetch';
import fs from 'fs';
import url from 'url';

import Parser from 'rss-parser';

/* paramters */
const sourceBlogUrl = "https://blog.hatenablog.com/entry/codechronicle";
const souceBlogDate = "2020-01-16 00:00:00";

const parser = new Parser({
  customFields: {
    item: [["hatena:bookmarkCommentListPageUrl", "hatena__bookmarkCommentListPageUrl"], ["description", "description"]]
  },
});

const xpath = require('xpath');
const parse5 = require('parse5');
const xmlser = require('xmlserializer');
const dom = require('xmldom').DOMParser;

const defaultSleepMilliseconds = 1000;

const getSelect = () => xpath.useNamespaces({"x": "http://www.w3.org/1999/xhtml"});
const parseDoc = (html: string) => {
  const document = parse5.parse(html);
  const xhtml = xmlser.serializeToString(document);
  return new dom().parseFromString(xhtml);
};

const mergeDedupe = <T>(arr: T[][]) => {
  return [...new Set(([] as T[]).concat(...arr))];
}
  
function searchFullArticles(data: any, key: string) {
  let urls: string[] = [];
  for(const item of data) {
    if(item.description.indexOf(key) !== -1) {
      urls.push(item.link);
    }
  }
  
  return urls;
}

function searchHatenaArticles(data: any, key: string) {
  let urls: string[] = [];
  for(const item of data) {
    for(const article of item.articles) {
      if(article.description.indexOf(key) !== -1) {
        urls.push(article.link);
      }
    }
  }
  
  return urls;
}

async function getBookmarkedUserBookmarkedPages(articleUrl: string, articleDate: string, waitMilliseconds?: number) {
  waitMilliseconds = waitMilliseconds || defaultSleepMilliseconds;
  let ret = [];
  
  try {
    //URLのドメイン
    const aboutUrl = url.parse(articleUrl).hostname + "/about";
    const html = await nfetch("https://" + aboutUrl).then(res => res.text());
    const doc = parseDoc(html);
    const select = getSelect();
    const nodes = select("//x:span[@data-user-name]", doc);
    
    const userName = nodes[0].attributes.getNamedItem("data-user-name").nodeValue;
    const bmUrl = "https://b.hatena.ne.jp/api/users/" + userName + "/bookmarks";
    const bookmarkObject = await nfetch(bmUrl).then(res => res.json());
    
    //bookmarkの同時取得件数は最大20件（それ以上はページを指定する必要）
    for(const bookmark of bookmarkObject.item.bookmarks.filter((item: any) => articleDate < new Date(item.created).toISOString())) {
      try {
        const html = await nfetch(bookmark.url).then(res => res.text());
        console.log(bookmark.url);
        
        ret.push({link: bookmark.url, description: html});
      } catch(e) {
        console.log({ suberror: e });
      }
      
      await sleep(waitMilliseconds);
    }
  } catch (e) {
    console.log({ suberror2: e });
    return [];
  }
  
  return ret;
}

async function getBookmarkingUserBlogPages(articleUrl: string, articleDate: string, waitMilliseconds?: number) {
  waitMilliseconds = waitMilliseconds || defaultSleepMilliseconds;
  let ret = [];
  
  //limitを付けないと，取得件数がもっと少なくなる
  const bmCommentJson
    = "https://b.hatena.ne.jp/api/entry/" + encodeURIComponent(articleUrl) + "/bookmarks?limit=500"; //"&commented_only=1";

  const bmComments = await nfetch(bmCommentJson).then(res => res.json());
  
  for(const bookmark of bmComments.bookmarks){
    const username = bookmark.user.name;
    const tempUrl = "http://blog.hatena.ne.jp/" + username + "/";
    
    const res = await nfetch(tempUrl, { redirect: "manual" });
    if(res.status === 301) {
      const blogUrl = res.headers.get("location");
      const rssUrl = blogUrl + "rss";
      try {
        const feed = await parser.parseURL(rssUrl);                
        console.log({ "SUB feed title: ": feed.title });
        
        if(feed.items === undefined) throw "err";
        
        let articles = [];
        const filtered = feed.items.filter((item: any) => articleDate < new Date(item.pubDate).toISOString());
        for(const item of filtered){ 
          articles.push({
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
            description: item.description
          });
        };
        
        ret.push({
          username,
          blog_title: feed.title,
          articles
        });
      } catch (e) {
        console.log({ suberror: e });
      }
    }
    
    await sleep(waitMilliseconds);
  };
  
  return ret;
}

(async () => {
  const json1 = await getBookmarkedUserBookmarkedPages(sourceBlogUrl, new Date(souceBlogDate).toISOString(), 500);
  await fs.promises.writeFile('jsondata-1.json', JSON.stringify(json1));
  const json2 = await getBookmarkingUserBlogPages(sourceBlogUrl, new Date(souceBlogDate).toISOString(), 200);
  await fs.promises.writeFile('jsondata-2.json', JSON.stringify(json2));
  
  const urls1 = searchFullArticles(json1, sourceBlogUrl);
  const urls2 = searchHatenaArticles(json2, sourceBlogUrl);
  const res = mergeDedupe([urls1, urls2]).filter(url => url !== sourceBlogUrl);
  console.log(res);
  await fs.promises.writeFile('result.json', JSON.stringify(res));
})();

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  });
}

//403は限定公開 / 非公開
//404はブログが無い
//意外とブックマークしている人で記事を書いている人が少なかった
