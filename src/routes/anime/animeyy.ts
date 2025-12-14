import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import axios from 'axios';
import { load } from 'cheerio';
import { Redis } from 'ioredis';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const BASE_URL = 'https://animeyy.com';

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the animeyy provider: check out the provider's website @ https://animeyy.com",
      routes: ['/watch'],
      documentation: 'Custom AnimeYY provider for Cosmunet',
    });
  });

  fastify.get('/watch', async (request: FastifyRequest, reply: FastifyReply) => {
    const episodeId = (request.query as { episodeId: string }).episodeId;

    if (typeof episodeId === 'undefined')
      return reply.status(400).send({ message: 'episodeId is required' });

    try {
      let res = redis
        ? await cache.fetch(
            redis as Redis,
            `animeyy:watch:${episodeId}`,
            async () => await fetchEpisodeSources(episodeId),
            REDIS_TTL,
          )
        : await fetchEpisodeSources(episodeId);

      reply.status(200).send(res);
    } catch (err: any) {
      console.error('AnimeYY watch error:', err);
      reply.status(500).send({
        message: 'Something went wrong. Contact developer for help.',
        error: err.message || 'Unknown error',
      });
    }
  });

  async function fetchEpisodeSources(episodeId: string) {
    try {
      // Clean up episodeId - remove leading/trailing slashes
      const cleanEpisodeId = episodeId.replace(/^\/+|\/+$/g, '');
      const episodeUrl = `${BASE_URL}/${cleanEpisodeId}/`;

      const { data } = await axios.get(episodeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': BASE_URL,
        },
      });

      const $ = load(data);
      const sources: any[] = [];

      // Extract iframe src
      let iframeSrc: string | null = null;
      $('iframe').each((i, el) => {
        const src = $(el).attr('src');
        if (src) {
          iframeSrc = src.startsWith('http') ? src : `${BASE_URL}${src}`;
        }
      });

      // Look for m3u8 URLs in script tags
      $('script').each((i, el) => {
        const scriptContent = $(el).html() || '';

        // Look for m3u8 URLs in scripts
        const m3u8Matches = scriptContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
        if (m3u8Matches) {
          m3u8Matches.forEach(url => {
            // Clean up the URL (remove any trailing characters)
            const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
            sources.push({
              url: cleanUrl,
              quality: 'auto',
              isM3U8: true,
            });
          });
        }

        // Look for mp4 URLs in scripts
        const mp4Matches = scriptContent.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/g);
        if (mp4Matches) {
          mp4Matches.forEach(url => {
            const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
            sources.push({
              url: cleanUrl,
              quality: 'auto',
              isM3U8: false,
            });
          });
        }

        // Look for video source patterns in JavaScript
        const sourcePatterns = [
          /["']file["']\s*:\s*["']([^"']+)["']/g,
          /["']src["']\s*:\s*["']([^"']+)["']/g,
          /["']source["']\s*:\s*["']([^"']+)["']/g,
        ];

        sourcePatterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(scriptContent)) !== null) {
            const url = match[1];
            if (url && (url.includes('.m3u8') || url.includes('.mp4'))) {
              sources.push({
                url: url,
                quality: 'auto',
                isM3U8: url.includes('.m3u8'),
              });
            }
          }
        });
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
          Referer: BASE_URL,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        sources: uniqueSources,
        iframe: iframeSrc,
        download: uniqueSources.length > 0 ? uniqueSources[0].url : null,
      };
    } catch (err: any) {
      console.error('Error fetching AnimeYY episode sources:', err.message);
      throw new Error(`Failed to fetch episode sources: ${err.message}`);
    }
  }
};

export default routes;


