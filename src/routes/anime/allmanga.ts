import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { load } from 'cheerio';
import { Redis } from 'ioredis';
import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const BASE_URL = 'https://allmanga.to';
  let browser: any = null;

  // Initialize browser on startup
  const initBrowser = async () => {
    if (!browser) {
      try {
        browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--window-size=1920,1080',
          ],
          ignoreHTTPSErrors: true,
        });
        console.log('Puppeteer browser initialized for allmanga');
      } catch (err) {
        console.error('Failed to initialize browser:', err);
      }
    }
    return browser;
  };

  // Cleanup browser on shutdown
  fastify.addHook('onClose', async () => {
    if (browser) {
      await browser.close();
      console.log('Puppeteer browser closed for allmanga');
    }
  });

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the allmanga provider: check out the provider's website @ https://allmanga.to/bangumi/",
      routes: ['/watch'],
      documentation: 'Custom Allmanga provider for Cosmunet with Puppeteer + Stealth',
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
            `allmanga:watch:${episodeId}`,
            async () => await fetchEpisodeSources(episodeId),
            REDIS_TTL,
          )
        : await fetchEpisodeSources(episodeId);

      reply.status(200).send(res);
    } catch (err: any) {
      console.error('Allmanga watch error:', err);
      reply.status(500).send({
        message: 'Something went wrong. Contact developer for help.',
        error: err.message || 'Unknown error',
      });
    }
  });

  async function fetchEpisodeSources(episodeId: string) {
    let page: any = null;
    
    try {
      // Clean up episodeId - remove leading/trailing slashes
      const cleanEpisodeId = episodeId.replace(/^\/+|\/+$/g, '');
      const episodeUrl = `${BASE_URL}/bangumi/${cleanEpisodeId}`;

      // Initialize browser if not already done
      const browserInstance = await initBrowser();
      if (!browserInstance) {
        throw new Error('Failed to initialize browser');
      }

      // Create a new page
      page = await browserInstance.newPage();

      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      });

      // Evaluate some JavaScript to make the browser look more real
      await page.evaluateOnNewDocument(() => {
        // Override the navigator.webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        // Override the navigator.plugins to make it look like a real browser
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        // Override the navigator.languages to make it look more real
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });

        // Add Chrome object
        (window as any).chrome = {
          runtime: {},
        };

        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : originalQuery(parameters);
      });

      console.log(`Navigating to: ${episodeUrl}`);

      // Array to store captured video URLs from network requests
      const capturedUrls: string[] = [];

      // Enable request interception to capture m3u8 URLs
      await page.setRequestInterception(true);
      
      page.on('request', (request: any) => {
        request.continue();
      });

      page.on('response', async (response: any) => {
        const url = response.url();
        // Capture m3u8 URLs and wixstatic URLs
        if (url.includes('.m3u8') || 
            url.includes('wixstatic.com') || 
            url.includes('repackager.wixmp.com')) {
          console.log('Captured URL from network:', url);
          if (!capturedUrls.includes(url)) {
            capturedUrls.push(url);
          }
        }
      });

      // Navigate to the page and wait for network to be idle
      await page.goto(episodeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      console.log('Page loaded, waiting for Cloudflare...');

      // Wait for Cloudflare challenge to complete
      // Try to wait for the challenge to disappear (up to 30 seconds)
      let cloudflareCleared = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const currentContent = await page.content();
        const currentTitle = await page.title();
        
        // Check if Cloudflare challenge is gone
        if (!currentTitle.includes('Just a moment') && 
            !currentTitle.includes('Attention Required') &&
            !currentContent.includes('challenge-platform') &&
            !currentContent.includes('cf-browser-verification')) {
          cloudflareCleared = true;
          console.log(`Cloudflare cleared after ${i + 1} seconds`);
          break;
        }
      }

      if (!cloudflareCleared) {
        await page.close();
        throw new Error('Cloudflare challenge still active after 30 seconds. The site may be blocking automated access.');
      }

      // Try to wait for video player elements to appear
      try {
        await Promise.race([
          page.waitForSelector('iframe', { timeout: 10000 }),
          page.waitForSelector('video', { timeout: 10000 }),
          page.waitForSelector('[data-player]', { timeout: 10000 }),
          page.waitForSelector('.player', { timeout: 10000 }),
          new Promise(resolve => setTimeout(resolve, 10000)),
        ]);
        console.log('Video player element found');
      } catch (err) {
        console.log('No video player element found, continuing anyway');
      }

      // Wait a bit more for any dynamic content to load and video player to initialize
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Get the page content
      const content = await page.content();

      console.log('Page content length:', content.length);
      console.log('Captured URLs from network:', capturedUrls.length);

      // Close the page
      await page.close();

      const $ = load(content);
      const sources: any[] = [];

      // Add captured URLs from network requests first (most reliable)
      capturedUrls.forEach(url => {
        if (url.includes('.m3u8')) {
          sources.push({
            url: url,
            quality: 'auto',
            isM3U8: true,
            source: 'network',
          });
          console.log('Added source from network:', url);
        }
      });

      console.log('Page loaded successfully, extracting sources from HTML...');

      // Extract iframe sources
      let iframeSrc: string | null = null;
      const iframes = $('iframe');
      console.log(`Found ${iframes.length} iframes`);
      
      $('iframe').each((i, el) => {
        const src = $(el).attr('src');
        console.log(`Iframe ${i} src:`, src);
        if (src) {
          const fullSrc = src.startsWith('http') ? src : `${BASE_URL}${src}`;
          if (!iframeSrc) {
            iframeSrc = fullSrc;
            console.log('Using iframe:', iframeSrc);
          }
        }
      });

      // Extract video sources from video tags
      $('video source, video').each((i, el) => {
        const src = $(el).attr('src') || $(el).find('source').attr('src');
        if (src) {
          sources.push({
            url: src.startsWith('http') ? src : `${BASE_URL}${src}`,
            quality: $(el).attr('data-quality') || $(el).attr('quality') || 'auto',
            isM3U8: src.includes('.m3u8'),
          });
        }
      });

      // Extract video sources from script tags
      const scriptCount = $('script').length;
      console.log(`Found ${scriptCount} script tags`);

      $('script').each((i, el) => {
        const scriptContent = $(el).html() || '';

        // Look for wixstatic m3u8 URLs (allmanga specific pattern)
        const wixMatches = scriptContent.match(/https?:\/\/[^\s"']*wixstatic\.com[^\s"']*\.m3u8[^\s"']*/g);
        if (wixMatches) {
          wixMatches.forEach(url => {
            const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
            console.log('Found wixstatic URL in script:', cleanUrl);
            if (!sources.find(s => s.url === cleanUrl)) {
              sources.push({
                url: cleanUrl,
                quality: 'auto',
                isM3U8: true,
                source: 'script',
              });
            }
          });
        }

        // Look for repackager URLs (another allmanga pattern) - more flexible pattern
        const repackagerMatches = scriptContent.match(/https?:\/\/repackager\.wixmp\.com[^\s"']+/g);
        if (repackagerMatches) {
          repackagerMatches.forEach(url => {
            const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
            console.log('Found repackager URL in script:', cleanUrl);
            if (!sources.find(s => s.url === cleanUrl)) {
              sources.push({
                url: cleanUrl,
                quality: 'auto',
                isM3U8: cleanUrl.includes('.m3u8'),
                source: 'script',
              });
            }
          });
        }

        // Look for any wixmp.com URLs (video platform used by allmanga)
        const wixmpMatches = scriptContent.match(/https?:\/\/[^\s"']*wixmp\.com[^\s"']+/g);
        if (wixmpMatches) {
          wixmpMatches.forEach(url => {
            const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
            if ((cleanUrl.includes('.m3u8') || cleanUrl.includes('video')) && 
                !sources.find(s => s.url === cleanUrl)) {
              console.log('Found wixmp URL in script:', cleanUrl);
              sources.push({
                url: cleanUrl,
                quality: 'auto',
                isM3U8: cleanUrl.includes('.m3u8'),
                source: 'script',
              });
            }
          });
        }

        // Look for general m3u8 URLs
        const m3u8Matches = scriptContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
        if (m3u8Matches) {
          m3u8Matches.forEach(url => {
            const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
            if (!sources.find(s => s.url === cleanUrl)) {
              console.log('Found m3u8 URL:', cleanUrl);
              sources.push({
                url: cleanUrl,
                quality: 'auto',
                isM3U8: true,
              });
            }
          });
        }

        // Look for mp4 URLs
        const mp4Matches = scriptContent.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/g);
        if (mp4Matches) {
          mp4Matches.forEach(url => {
            const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
            if (!sources.find(s => s.url === cleanUrl)) {
              sources.push({
                url: cleanUrl,
                quality: 'auto',
                isM3U8: false,
              });
            }
          });
        }

        // Look for video source patterns in JavaScript variables
        const sourcePatterns = [
          /["']file["']\s*:\s*["']([^"']+)["']/g,
          /["']src["']\s*:\s*["']([^"']+)["']/g,
          /["']source["']\s*:\s*["']([^"']+)["']/g,
          /["']url["']\s*:\s*["']([^"']+)["']/g,
        ];

        sourcePatterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(scriptContent)) !== null) {
            const url = match[1];
            if (url && (url.includes('.m3u8') || url.includes('.mp4') || url.includes('wixstatic'))) {
              if (!sources.find(s => s.url === url)) {
                sources.push({
                  url: url,
                  quality: 'auto',
                  isM3U8: url.includes('.m3u8'),
                });
              }
            }
          }
        });
      });

      // Look for video player data attributes
      $('[data-player], [data-video], [data-src], .player, .video-player, #video-player').each((i, el) => {
        const dataAttrs = ['data-player', 'data-video', 'data-src', 'data-source', 'data-file'];
        
        dataAttrs.forEach(attr => {
          const dataValue = $(el).attr(attr);
          if (dataValue) {
            try {
              // Try to parse as JSON
              const parsed = JSON.parse(dataValue);
              if (parsed.sources || parsed.file || parsed.url) {
                const videoSources = parsed.sources || [parsed];
                videoSources.forEach((source: any) => {
                  const url = source.file || source.url || source.src;
                  if (url && !sources.find(s => s.url === url)) {
                    sources.push({
                      url: url,
                      quality: source.quality || source.label || 'auto',
                      isM3U8: url.includes('.m3u8'),
                    });
                  }
                });
              }
            } catch (e) {
              // Not JSON, might be a direct URL
              if (dataValue.startsWith('http') && !sources.find(s => s.url === dataValue)) {
                sources.push({
                  url: dataValue,
                  quality: 'auto',
                  isM3U8: dataValue.includes('.m3u8'),
                });
              }
            }
          }
        });
      });

      // Remove duplicates early
      let uniqueSources = Array.from(
        new Map(sources.map(item => [item.url, item])).values()
      );

      // If we found an iframe but no direct sources, try to load the iframe
      if (iframeSrc && (uniqueSources.length === 0 || !uniqueSources.some(s => s.isM3U8))) {
        console.log('Trying to load iframe for additional sources:', iframeSrc);
        try {
          const iframePage = await browserInstance.newPage();
          const iframeCapturedUrls: string[] = [];

          // Enable request interception for iframe
          await iframePage.setRequestInterception(true);
          
          iframePage.on('request', (request: any) => {
            request.continue();
          });

          iframePage.on('response', async (response: any) => {
            const url = response.url();
            if (url.includes('.m3u8') || 
                url.includes('wixstatic.com') || 
                url.includes('repackager.wixmp.com')) {
              console.log('Captured URL from iframe network:', url);
              if (!iframeCapturedUrls.includes(url)) {
                iframeCapturedUrls.push(url);
              }
            }
          });

          await iframePage.setViewport({ width: 1920, height: 1080 });
          await iframePage.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          );
          await iframePage.setExtraHTTPHeaders({
            'Referer': episodeUrl,
          });
          
          await iframePage.goto(iframeSrc, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Add captured URLs from iframe network
          iframeCapturedUrls.forEach(url => {
            if (url.includes('.m3u8') && !sources.find(s => s.url === url)) {
              console.log('Adding source from iframe network:', url);
              sources.push({
                url: url,
                quality: 'auto',
                isM3U8: true,
                source: 'iframe-network',
              });
            }
          });

          const iframeContent = await iframePage.content();
          await iframePage.close();

          // Look for wixstatic URLs in iframe
          const wixMatches = iframeContent.match(/https?:\/\/[^\s"']*wixstatic\.com[^\s"']*\.m3u8[^\s"']*/g);
          if (wixMatches) {
            wixMatches.forEach((url: string) => {
              const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
              if (!sources.find(s => s.url === cleanUrl)) {
                console.log('Found wixstatic URL in iframe content:', cleanUrl);
                sources.push({
                  url: cleanUrl,
                  quality: 'auto',
                  isM3U8: true,
                  source: 'iframe-content',
                });
              }
            });
          }

          // Look for repackager URLs in iframe
          const repackagerMatches = iframeContent.match(/https?:\/\/repackager\.wixmp\.com[^\s"']+\.m3u8[^\s"']*/g);
          if (repackagerMatches) {
            repackagerMatches.forEach((url: string) => {
              const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
              if (!sources.find(s => s.url === cleanUrl)) {
                console.log('Found repackager URL in iframe content:', cleanUrl);
                sources.push({
                  url: cleanUrl,
                  quality: 'auto',
                  isM3U8: true,
                  source: 'iframe-content',
                });
              }
            });
          }

          // General m3u8 search in iframe
          const m3u8Matches = iframeContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
          if (m3u8Matches) {
            m3u8Matches.forEach((url: string) => {
              const cleanUrl = url.replace(/[\\'")\]},;]+$/, '');
              if (!sources.find(s => s.url === cleanUrl)) {
                console.log('Found m3u8 URL in iframe content:', cleanUrl);
                sources.push({
                  url: cleanUrl,
                  quality: 'auto',
                  isM3U8: true,
                  source: 'iframe-content',
                });
              }
            });
          }
        } catch (err) {
          console.error('Error fetching iframe content:', err);
        }
      }

      // Update uniqueSources after iframe processing
      uniqueSources = Array.from(
        new Map(sources.map(item => [item.url, item])).values()
      );

      console.log(`Found ${uniqueSources.length} unique sources after all processing`);
      console.log('Sources:', uniqueSources.map(s => ({ url: s.url.substring(0, 80), source: s.source })));

      // Final check: Add iframe as a backup if we have it and no m3u8 sources
      if (iframeSrc && uniqueSources.length === 0) {
        console.log('No sources found, adding iframe as fallback');
        uniqueSources.push({
          url: iframeSrc,
          quality: 'auto',
          isM3U8: false,
          type: 'iframe',
        });
      }

      console.log(`Returning ${uniqueSources.length} total sources`);

      return {
        headers: {
          Referer: BASE_URL,
          Origin: BASE_URL,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        sources: uniqueSources,
        iframe: iframeSrc,
        download: uniqueSources.length > 0 ? uniqueSources[0].url : null,
      };
    } catch (err: any) {
      console.error('Error fetching Allmanga episode sources:', err.message);

      // Close page if it's still open
      if (page) {
        try {
          await page.close();
        } catch (e) {
          // Ignore close errors
        }
      }

      // Provide more specific error messages
      if (err.message.includes('Cloudflare')) {
        throw err; // Pass through our custom Cloudflare error
      } else if (err.message.includes('timeout')) {
        throw new Error('Request timeout. Allmanga.to may be slow or unreachable.');
      } else if (err.message.includes('navigation')) {
        throw new Error('Failed to navigate to episode page. It may not exist or be unavailable.');
      }

      throw new Error(`Failed to fetch episode sources: ${err.message}`);
    }
  }
};

export default routes;
