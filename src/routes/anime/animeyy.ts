import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import axios from 'axios';
import { load } from 'cheerio';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const BASE_URL = 'https://animeyy.com';

  // Helper to clean URLs (remove newlines, whitespace, etc.)
  const cleanUrl = (url: string): string => {
    return url.replace(/[\n\r\s]+/g, '').replace(/[\\'")\]},;]+$/, '');
  };

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the animeyy provider: check out the provider's website @ https://animeyy.com",
      routes: ['/:query', '/info', '/watch'],
      documentation: 'Custom AnimeYY provider for Cosmunet',
    });
  });

  // Search endpoint
  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    const page = (request.query as { page?: number }).page || 1;

    if (typeof query === 'undefined')
      return reply.status(400).send({ message: 'query is required' });

    try {
      const res = await searchAnime(query, page);
      reply.status(200).send(res);
    } catch (err: any) {
      console.error('AnimeYY search error:', err);
      reply.status(500).send({
        message: 'Something went wrong. Contact developer for help.',
        error: err.message || 'Unknown error',
      });
    }
  });

  // Info endpoint
  // Use ?page=1 for episodes 1-100, ?page=2 for 101-200, etc.
  // Omit page to fetch ALL episodes
  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;
    const page = (request.query as { page?: string }).page
      ? parseInt((request.query as { page: string }).page)
      : undefined;

    if (typeof id === 'undefined')
      return reply.status(400).send({ message: 'id is required' });

    try {
      const res = await fetchAnimeInfo(id, page);
      reply.status(200).send(res);
    } catch (err: any) {
      console.error('AnimeYY info error:', err);
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
      const res = await fetchEpisodeSources(episodeId);
      reply.status(200).send(res);
    } catch (err: any) {
      console.error('AnimeYY watch error:', err);
      reply.status(500).send({
        message: 'Something went wrong. Contact developer for help.',
        error: err.message || 'Unknown error',
      });
    }
  });

  async function searchAnime(query: string, page: number = 1) {
    try {
      const searchUrl = `${BASE_URL}/?act=search&f[status]=all&f[sortby]=top-manga&f[keyword]=${encodeURIComponent(query)}&page=${page}`;

      const { data } = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': BASE_URL,
        },
      });

      const $ = load(data);
      const results: any[] = [];
      const seenIds = new Set<string>();

      // Parse search results - animeyy uses anchor tags with title attribute and h3 inside
      $('a[href^="/"]').each((_, el) => {
        const $el = $(el);
        const url = $el.attr('href') || '';
        const title = $el.attr('title') || $el.find('h3').text().trim() || '';
        const image = $el.find('img').attr('src') || '';

        // Match anime pages ending with -number (e.g., /one-piece-63/, /naruto-888/)
        const idMatch = url.match(/^\/([^\/]+-\d+)\/?$/);
        if (!idMatch) return;

        const id = idMatch[1];

        // Skip duplicates and episode pages
        if (seenIds.has(id) || url.includes('/epi-')) return;
        seenIds.add(id);

        if (title && id) {
          results.push({
            id,
            title,
            url: `${BASE_URL}${url}`,
            image: image ? (image.startsWith('http') ? image : `${BASE_URL}/${image.replace(/^\//, '')}`) : '',
          });
        }
      });

      // If no results found with anchor parsing, try to extract from raw HTML
      if (results.length === 0) {
        // Try finding title in title attribute
        const titleAttrPattern = /href=["'](\/[^"']+\-\d+\/)["'][^>]*title=["']([^"']+)["']/gi;
        let match;
        while ((match = titleAttrPattern.exec(data)) !== null) {
          const url = match[1];
          const title = match[2].trim();
          const idMatch = url.match(/\/([^\/]+-\d+)\/?$/);
          if (idMatch && title && !seenIds.has(idMatch[1]) && !url.includes('/epi-')) {
            seenIds.add(idMatch[1]);
            results.push({
              id: idMatch[1],
              title,
              url: `${BASE_URL}${url}`,
              image: '',
            });
          }
        }

        // Reverse pattern: title first, then href
        const reverseTitlePattern = /title=["']([^"']+)["'][^>]*href=["'](\/[^"']+-\d+\/)["']/gi;
        while ((match = reverseTitlePattern.exec(data)) !== null) {
          const title = match[1].trim();
          const url = match[2];
          const idMatch = url.match(/\/([^\/]+-\d+)\/?$/);
          if (idMatch && title && !seenIds.has(idMatch[1]) && !url.includes('/epi-')) {
            seenIds.add(idMatch[1]);
            results.push({
              id: idMatch[1],
              title,
              url: `${BASE_URL}${url}`,
              image: '',
            });
          }
        }
      }

      return {
        currentPage: page,
        results,
      };
    } catch (err: any) {
      console.error('Error searching AnimeYY:', err.message);
      throw new Error(`Failed to search: ${err.message}`);
    }
  }

  async function fetchAnimeInfo(id: string, page?: number) {
    try {
      const cleanId = id.replace(/^\/+|\/+$/g, '');
      const animeUrl = `${BASE_URL}/${cleanId}/`;

      const { data } = await axios.get(animeUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': BASE_URL,
        },
      });

      const $ = load(data);

      // Extract anime info
      const title = $('h1, .title, .film-name, .anime-title').first().text().trim() ||
                    $('meta[property="og:title"]').attr('content') || '';

      const description = $('.description, .synopsis, .summary, .film-description, p.desc').first().text().trim() ||
                          $('meta[property="og:description"]').attr('content') || '';

      const image = $('.poster img, .film-poster img, .anime-poster img, .cover img').first().attr('src') ||
                    $('meta[property="og:image"]').attr('content') || '';

      // Extract additional info
      const genres: string[] = [];
      $('.genres a, .genre a, .tags a').each((_, el) => {
        genres.push($(el).text().trim());
      });

      const status = $('.status, .film-status').text().trim() || '';
      const releaseDate = $('.release, .year, .aired').text().trim() || '';

      // Extract manga_id from the URL slug (e.g., one-piece-63 -> 63)
      const mangaIdMatch = cleanId.match(/-(\d+)$/);
      const mangaId = mangaIdMatch ? mangaIdMatch[1] : null;

      // Extract episodes
      const episodes: any[] = [];
      const seenEpisodeIds = new Set<string>();

      const parseEpisodes = (html: string) => {
        const $ep = load(html);
        $ep('a[href*="/epi-"]').each((_, el) => {
          const $el = $ep(el);
          const epUrl = $el.attr('href') || '';
          const epTitle = $el.text().trim() || $el.attr('title') || '';

          // Extract episode ID from URL (e.g., /one-piece-63/epi-1155-113069/)
          const epIdMatch = epUrl.match(/\/(epi-[\d-]+)\/?$/);
          const episodeId = epIdMatch ? `${cleanId}/${epIdMatch[1]}` : '';

          // Skip duplicates
          if (!episodeId || seenEpisodeIds.has(episodeId)) return;
          seenEpisodeIds.add(episodeId);

          // Extract episode number from URL pattern epi-{number}-{id}
          const epNumMatch = epUrl.match(/epi-(\d+)-/);
          const episodeNumber = epNumMatch ? parseInt(epNumMatch[1]) : episodes.length + 1;

          episodes.push({
            id: episodeId,
            number: episodeNumber,
            title: epTitle || `Episode ${episodeNumber}`,
            url: epUrl.startsWith('http') ? epUrl : `${BASE_URL}${epUrl}`,
          });
        });
      };

      if (mangaId) {
        // Fetch ALL episodes by looping through all pages
        // (API returns in reverse order, so we need all episodes to paginate correctly)
        let pageNum = 1;
        let hasMore = true;
        let emptyCount = 0;

        while (hasMore && pageNum <= 50) { // Max 50 pages for safety (5000 episodes)
          try {
            const ajaxUrl = `${BASE_URL}/?act=ajax&code=load_list_chapter&manga_id=${mangaId}&page_num=${pageNum}&chap_id=0&keyword=`;

            const { data: ajaxData } = await axios.get(ajaxUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': animeUrl,
              },
            });

            // Response is JSON: {"list_chap":"<html>..."}
            let htmlContent: string | null = null;

            if (ajaxData && typeof ajaxData === 'object' && ajaxData.list_chap) {
              htmlContent = ajaxData.list_chap;
            } else if (ajaxData && typeof ajaxData === 'string') {
              htmlContent = ajaxData;
            }

            if (htmlContent && htmlContent.includes('/epi-')) {
              const beforeCount = episodes.length;
              parseEpisodes(htmlContent);

              // If no new episodes were added, increment empty counter
              if (episodes.length === beforeCount) {
                emptyCount++;
                if (emptyCount >= 2) { // Stop after 2 consecutive empty pages
                  hasMore = false;
                }
              } else {
                emptyCount = 0; // Reset on success
              }

              pageNum++;
            } else {
              // Empty response, stop fetching
              hasMore = false;
            }
          } catch (err) {
            console.error(`Error fetching page ${pageNum}:`, err);
            hasMore = false;
          }
        }
      }

      // Fallback: parse episodes from initial page if AJAX didn't work
      if (episodes.length === 0) {
        parseEpisodes(data);
      }

      // Sort episodes by number (ascending: 1, 2, 3, ...)
      episodes.sort((a, b) => a.number - b.number);

      // Store total episodes count before slicing
      const totalEpisodes = episodes.length;

      // If page is specified, slice the array to return only that page's episodes
      let paginatedEpisodes = episodes;
      if (page !== undefined && page > 0) {
        const startIndex = (page - 1) * 100;
        const endIndex = startIndex + 100;
        paginatedEpisodes = episodes.slice(startIndex, endIndex);
      }

      // Build response
      const response: any = {
        id: cleanId,
        title,
        url: animeUrl,
        image: image.startsWith('http') ? image : (image ? `${BASE_URL}${image}` : ''),
        description,
        genres,
        status,
        releaseDate,
        totalEpisodes: totalEpisodes,
        episodes: paginatedEpisodes,
      };

      // Add pagination info if page was specified
      if (page !== undefined) {
        response.currentPage = page;
        response.hasNextPage = (page * 100) < totalEpisodes;
      }

      return response;
    } catch (err: any) {
      console.error('Error fetching AnimeYY info:', err.message);
      throw new Error(`Failed to fetch anime info: ${err.message}`);
    }
  }

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
      $('iframe').each((_, el) => {
        const src = $(el).attr('src');
        if (src) {
          const cleaned = cleanUrl(src);
          iframeSrc = cleaned.startsWith('http') ? cleaned : `${BASE_URL}${cleaned}`;
        }
      });

      // Look for m3u8 URLs in script tags
      $('script').each((_, el) => {
        const scriptContent = $(el).html() || '';

        // Look for m3u8 URLs in scripts
        const m3u8Matches = scriptContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
        if (m3u8Matches) {
          m3u8Matches.forEach(url => {
            const cleaned = cleanUrl(url);
            sources.push({
              url: cleaned,
              quality: 'auto',
              isM3U8: true,
            });
          });
        }

        // Look for mp4 URLs in scripts
        const mp4Matches = scriptContent.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/g);
        if (mp4Matches) {
          mp4Matches.forEach(url => {
            const cleaned = cleanUrl(url);
            sources.push({
              url: cleaned,
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
            const url = cleanUrl(match[1]);
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
              const cleaned = cleanUrl(url);
              sources.push({
                url: cleaned,
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

      // Add iframe as a backup if we have it and no sources found
      if (iframeSrc !== null && uniqueSources.length === 0) {
        // Check if iframe URL contains m3u8
        const iframeUrl: string = iframeSrc;
        const isM3U8 = iframeUrl.includes('.m3u8');
        uniqueSources.push({
          url: iframeUrl,
          quality: 'auto',
          isM3U8: isM3U8,
          type: 'iframe',
        });
      }

      // Replace "embed" with "anime" in all URLs
      const fixedSources = uniqueSources.map(source => ({
        ...source,
        url: source.url.replace(/\/embed\//g, '/anime/'),
      }));

      const fixedIframeSrc = iframeSrc ? (iframeSrc as string).replace(/\/embed\//g, '/anime/') : null;

      return {
        headers: {
          Referer: BASE_URL,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        sources: fixedSources,
        iframe: fixedIframeSrc,
        download: fixedSources.length > 0 ? fixedSources[0].url : null,
      };
    } catch (err: any) {
      console.error('Error fetching AnimeYY episode sources:', err.message);
      throw new Error(`Failed to fetch episode sources: ${err.message}`);
    }
  }
};

export default routes;
