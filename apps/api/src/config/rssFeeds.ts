import { env } from './env.js'
import { logger } from './logger.js'

const DEFAULT_RSS_FEEDS = [
  'https://www.thehindu.com/news/national/feeder/default.rss',
  'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
  'https://indianexpress.com/section/india/feed/',
  'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml',
  'https://www.ndtv.com/india-news/rss',
] as const

const parseCsvUrls = (value: string): string[] => {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const configuredFeedUrls = env.RSS_FEED_URLS
  ? parseCsvUrls(env.RSS_FEED_URLS)
  : []

export const rssFeedSources =
  configuredFeedUrls.length > 0
    ? configuredFeedUrls
    : [...DEFAULT_RSS_FEEDS]

logger.info({ feedCount: rssFeedSources.length }, 'RSS feed source list ready')
