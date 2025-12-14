
import { ANIME } from '@consumet/extensions';

(async () => {
    const animepahe = new ANIME.AnimePahe();
    const episodeId = '502cfece-46d7-d166-eb2a-dd44cfdc92c9/21322d80cf11b60348150d76cba4a251ed9662af29f656b61d44051b04fa17ee';

    console.log(`Fetching episode sources for: ${episodeId}`);

    try {
        const res = await animepahe.fetchEpisodeSources(episodeId);
        console.log('Result:', JSON.stringify(res, null, 2));

        // Simulate the code in the route
        if (res) {
            (res as any).headers = {
                ...((res as any).headers || {}),
                Referer: 'https://kwik.cx',
            };
            console.log('Modified Result:', JSON.stringify(res, null, 2));
        } else {
            console.log('Result is null or undefined');
        }

    } catch (error) {
        console.error('Error occurred:', error);
    }
})();
