import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import axios from 'axios';
import { load } from 'cheerio';
import { Redis } from 'ioredis';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const BASE_URL = 'https://anizone.to';

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the anizone provider: check out the provider's website @ https://anizone.to",
      routes: ['/:query', '/info/:id', '/watch/:episodeId'],
      documentation: 'Custom Anizone provider for Cosmunet',
    });
  });

  // Search endpoint
  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;

    if (typeof query === 'undefined')
      return reply.status(400).send({ message: 'query is required' });

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `anizone:search:${query}`,
          async () => await searchAnime(query),
          REDIS_TTL,
        )
        : await searchAnime(query);

      reply.status(200).send(res);
    } catch (err: any) {
      console.error('Anizone search error:', err);
      reply.status(500).send({
        message: 'Something went wrong. Contact developer for help.',
        error: err.message || 'Unknown error',
      });
    }
  });

  // Info endpoint
  fastify.get('/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = decodeURIComponent((request.params as { id: string }).id);

    if (typeof id === 'undefined')
      return reply.status(400).send({ message: 'id is required' });

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `anizone:info:${id}`,
          async () => await fetchAnimeInfo(id),
          REDIS_TTL,
        )
        : await fetchAnimeInfo(id);

      reply.status(200).send(res);
    } catch (err: any) {
      console.error('Anizone info error:', err);
      reply.status(500).send({
        message: 'Something went wrong. Contact developer for help.',
        error: err.message || 'Unknown error',
      });
    }
  });

  // Watch endpoint
  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;

    if (typeof episodeId === 'undefined')
      return reply.status(400).send({ message: 'episodeId is required' });

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `anizone:watch:${episodeId}`,
          async () => await fetchEpisodeSources(episodeId),
          REDIS_TTL,
        )
        : await fetchEpisodeSources(episodeId);

      reply.status(200).send(res);
    } catch (err: any) {
      console.error('Anizone watch error:', err);
      reply.status(500).send({
        message: 'Something went wrong. Contact developer for help.',
        error: err.message || 'Unknown error',
      });
    }
  });

  // Helper function to search anime
  async function searchAnime(query: string) {
    try {
      // Fix: Use correct search URL pattern with + for spaces
      const searchQuery = query.replace(/\s+/g, '+');
      const searchUrl = `${BASE_URL}/anime?search=${searchQuery}`;

      const { data } = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': BASE_URL,
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 30000,
      });

      const $ = load(data);
      const results: any[] = [];

      // Parse search results - try multiple selector patterns
      $('.anime-item, .item, .card, .ani, .film_list-wrap .flw-item, .grid > div, .anime-list .item').each((i, el) => {
        const $el = $(el);

        // Try multiple title selectors
        const title = $el.find('.title, .film-name a, h3 a, h3, .name, a[title]').first().text().trim() ||
          $el.find('a').attr('title')?.trim() || '';

        // Extract ID from href
        const href = $el.find('a[href*="/anime/"]').first().attr('href') ||
          $el.find('a').first().attr('href') || '';

        // Extract just the anime ID, handling both full URLs and relative paths
        let id = '';
        if (href) {
          // Match pattern: /anime/{id} or https://anizone.to/anime/{id}
          const idMatch = href.match(/\/anime\/([^/\?#]+)/);
          if (idMatch) {
            id = idMatch[1];
          }
        }

        // Try multiple image selectors
        const image = $el.find('img').attr('src') ||
          $el.find('img').attr('data-src') ||
          $el.find('.poster img, img').first().attr('src') || '';

        // Extract metadata
        const releaseDate = $el.find('.release-date, .year, .fdi-item:contains("Released")').text().trim();
        const type = $el.find('.type, .badge, .fdi-item:contains("Type")').text().trim();
        const status = $el.find('.status').text().trim();

        if (title && id) {
          results.push({
            id: id,
            title: title,
            image: image.startsWith('http') ? image : (image ? `${BASE_URL}${image}` : ''),
            releaseDate: releaseDate || null,
            type: type || null,
            status: status || null,
            url: `${BASE_URL}/anime/${id}`,
          });
        }
      });

      return {
        currentPage: 1,
        hasNextPage: $('.pagination .next, .pagination a:contains("Next")').length > 0,
        results: results,
      };
    } catch (err: any) {
      console.error('Error searching anime on Anizone:', err.message);

      // Enhanced error handling
      if (err.response?.status === 403 || err.message.includes('Cloudflare')) {
        throw new Error('Access denied. The site may be blocking automated access.');
      } else if (err.message.includes('timeout') || err.code === 'ECONNABORTED') {
        throw new Error('Request timeout. Anizone.to may be slow or unreachable.');
      } else if (err.response?.status === 404) {
        throw new Error('Search endpoint not found. URL pattern may have changed.');
      }

      throw new Error(`Failed to search anime: ${err.message}`);
    }
  }

  // Helper function to fetch anime info
  async function fetchAnimeInfo(id: string) {
    try {
      const cleanId = id.replace(/^\/+|\/+$/g, '').replace(/^anime\//, '');
      // Fix: Add /anime/ prefix to URL
      const infoUrl = `${BASE_URL}/anime/${cleanId}`;

      const { data } = await axios.get(infoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': BASE_URL,
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 30000,
      });

      const $ = load(data);

      // Extract anime information using actual anizone.to selectors
      const title = $('h1').first().text().trim() ||
        $('meta[property="og:title"]').attr('content') || '';

      const image = $('img[alt]').first().attr('src') ||
        $('meta[property="og:image"]').attr('content') || '';

      // Description is in a div after h3 with class "sr-only" containing "Synopsis"
      let description = '';
      $('h3.sr-only').each((_i, el) => {
        const $h3 = $(el);
        if ($h3.text().toLowerCase().includes('synopsis')) {
          description = $h3.next('div').text().trim();
        }
      });
      if (!description) {
        description = $('meta[property="og:description"]').attr('content') || 'No description available';
      }

      // Extract genres from tag links
      const genres: string[] = [];
      $('a[href*="/tag/"]').each((_i, el) => {
        const genre = $(el).attr('title') || $(el).text().trim();
        if (genre) genres.push(genre);
      });

      // Extract episodes from list items containing anime links
      const episodes: any[] = [];
      $('li a[href*="/anime/"]').each((_i, el) => {
        const $ep = $(el);
        const href = $ep.attr('href') || '';

        // Extract anime ID and episode number from href
        const matches = href.match(/\/anime\/([^/]+)\/(\d+)$/);
        if (!matches) return;

        const animeId = matches[1];
        const episodeNumber = matches[2];
        const episodeId = `${animeId}/${episodeNumber}`;

        // Get episode title from h3 within the link
        const episodeTitle = $ep.find('h3').text().trim() || `Episode ${episodeNumber}`;

        if (episodeId && episodeNumber) {
          // Check if href already contains full URL or just path
          const episodeUrl = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;

          episodes.push({
            id: episodeId,
            number: parseInt(episodeNumber),
            title: episodeTitle,
            url: episodeUrl,
          });
        }
      });

      return {
        id: cleanId,
        title: title,
        url: infoUrl,
        image: image.startsWith('http') ? image : (image ? `${BASE_URL}${image}` : ''),
        description: description,
        genres: genres,
        episodes: episodes,
        totalEpisodes: episodes.length,
      };
    } catch (err: any) {
      console.error('Error fetching anime info from Anizone:', err.message);

      // Enhanced error handling
      if (err.response?.status === 403 || err.message.includes('Cloudflare')) {
        throw new Error('Access denied. The site may be blocking automated access.');
      } else if (err.message.includes('timeout') || err.code === 'ECONNABORTED') {
        throw new Error('Request timeout. Anizone.to may be slow or unreachable.');
      } else if (err.response?.status === 404) {
        throw new Error('Anime not found. It may not exist or be unavailable.');
      }

      throw new Error(`Failed to fetch anime info: ${err.message}`);
    }
  }

  // Helper function to fetch episode sources
  async function fetchEpisodeSources(episodeId: string) {
    try {
      const cleanEpisodeId = episodeId.replace(/^\/+|\/+$/g, '').replace(/^anime\//, '');
      // Fix: Construct URL as /anime/{id}/{episodeNumber}
      const episodeUrl = `${BASE_URL}/anime/${cleanEpisodeId}`;

      const { data } = await axios.get(episodeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': BASE_URL,
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 30000,
      });

      const $ = load(data);
      const sources: any[] = [];
      let iframeSrc: string | null = null;

      // Extract video UUID from seiryuu.vid-cdn.xyz URLs (in image src attributes)
      const videoIds: string[] = [];
      $('img[src*="seiryuu.vid-cdn.xyz"]').each((_i, el) => {
        const src = $(el).attr('src') || '';
        // Extract UUID from URL like: https://seiryuu.vid-cdn.xyz/{uuid}/snapshot.webp
        const match = src.match(/seiryuu\.vid-cdn\.xyz\/([a-f0-9\-]+)\//i);
        if (match && match[1]) {
          videoIds.push(match[1]);
        }
      });

      // Also check script tags for video IDs
      $('script').each((_i, el) => {
        const scriptContent = $(el).html() || '';

        // Extract seiryuu.vid-cdn.xyz video IDs from scripts
        const matches = scriptContent.match(/seiryuu\.vid-cdn\.xyz\/([a-f0-9\-]+)\//gi);
        if (matches) {
          matches.forEach(match => {
            const idMatch = match.match(/([a-f0-9\-]+)\/$/i);
            if (idMatch && idMatch[1] && !videoIds.includes(idMatch[1])) {
              videoIds.push(idMatch[1]);
            }
          });
        }
      });

      // Construct m3u8 URLs from collected video IDs
      videoIds.forEach(videoId => {
        const cdnBase = `https://seiryuu.vid-cdn.xyz/${videoId}`;
        sources.push({
          url: `${cdnBase}/master.m3u8`,
          quality: 'master',
          isM3U8: true,
        });
        sources.push({
          url: `${cdnBase}/playlist.m3u8`,
          quality: 'auto',
          isM3U8: true,
        });
      });

      // Extract iframe src as fallback
      $('iframe').each((_i, el) => {
        const src = $(el).attr('src');
        if (src) {
          iframeSrc = src.startsWith('http') ? src : `${BASE_URL}${src}`;
        }
      });

      // If we found an iframe but no direct sources, try to fetch from the iframe
      if (sources.length === 0 && iframeSrc) {
        try {
          const iframeResponse = await axios.get(iframeSrc, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': episodeUrl,
            },
          });

          const iframeData = iframeResponse.data;

          // Look for m3u8 URLs in iframe content
          const m3u8Matches = iframeData.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
          if (m3u8Matches) {
            m3u8Matches.forEach((url: string) => {
              const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
              sources.push({
                url: cleanUrl,
                quality: 'auto',
                isM3U8: true,
              });
            });
          }
        } catch (err) {
          console.error('Error fetching iframe content:', err);
        }
      }

      // Remove duplicates
      const uniqueSources = Array.from(
        new Map(sources.map(item => [item.url, item])).values()
      );

      // Add iframe as a backup if we have it
      if (iframeSrc && uniqueSources.length === 0) {
        uniqueSources.push({
          url: iframeSrc,
          quality: 'auto',
          isM3U8: false,
          type: 'iframe',
        });
      }

      return {
        headers: {
          Referer: 'https://seiryuu.vid-cdn.xyz',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        sources: uniqueSources,
        iframe: iframeSrc,
        download: uniqueSources.length > 0 ? uniqueSources[0].url : null,
      };
    } catch (err: any) {
      console.error('Error fetching Anizone episode sources:', err.message);

      // Enhanced error handling
      if (err.response?.status === 403 || err.message.includes('Cloudflare')) {
        throw new Error('Access denied. The site may be blocking automated access.');
      } else if (err.message.includes('timeout') || err.code === 'ECONNABORTED') {
        throw new Error('Request timeout. Anizone.to may be slow or unreachable.');
      } else if (err.response?.status === 404) {
        throw new Error('Episode not found. It may not exist or be unavailable.');
      }

      throw new Error(`Failed to fetch episode sources: ${err.message}`);
    }
  }
};

export default routes;
