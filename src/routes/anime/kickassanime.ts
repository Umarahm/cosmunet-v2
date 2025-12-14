import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import { ANIME } from '@consumet/extensions';
import { StreamingServers } from '@consumet/extensions/dist/models';

import cache from '../../utils/cache';
import { redis, REDIS_TTL } from '../../main';
import { Redis } from 'ioredis';

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const kickassanime = new ANIME.KickAssAnime();

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: `Welcome to the kickassanime provider: check out the provider's website @ ${kickassanime.toString.baseUrl}`,
      routes: ['/:query', '/info', '/watch/*', '/servers/*'],
      documentation: 'https://docs.consumet.org/#tag/kickassanime',
    });
  });

  fastify.get('/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.params as { query: string }).query;
    const page = (request.query as { page: number }).page;

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `kickassanime:search:${query}:${page}`,
          async () => await kickassanime.search(query, page),
          REDIS_TTL,
        )
        : await kickassanime.search(query, page);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.query as { id: string }).id;

    if (typeof id === 'undefined')
      return reply.status(400).send({ message: 'id is required' });

    try {
      let res = redis
        ? await cache.fetch(
          redis as Redis,
          `kickassanime:info:${id}`,
          async () => await kickassanime.fetchAnimeInfo(id),
          REDIS_TTL,
        )
        : await kickassanime.fetchAnimeInfo(id);

      reply.status(200).send(res);
    } catch (err) {
      reply
        .status(500)
        .send({ message: 'Something went wrong. Contact developer for help.' });
    }
  });

  fastify.get(
    '/watch/*',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const episodeId = (request.params as { '*': string })['*'];
      const server = (request.query as { server: StreamingServers }).server;

      if (typeof episodeId === 'undefined' || episodeId === '')
        return reply.status(400).send({ message: 'episodeId is required' });

      try {
        let res = redis
          ? await cache.fetch(
            redis as Redis,
            `kickassanime:watch:${episodeId}:${server || 'default'}`,
            async () => server ? await kickassanime.fetchEpisodeSources(episodeId, server) : await kickassanime.fetchEpisodeSources(episodeId),
            REDIS_TTL,
          )
          : server ? await kickassanime.fetchEpisodeSources(episodeId, server) : await kickassanime.fetchEpisodeSources(episodeId);

        reply.status(200).send(res);
      } catch (err) {
        console.error('Error fetching episode sources:', err);
        console.error('EpisodeId:', episodeId);
        console.error('Server:', server);
        reply
          .status(500)
          .send({ message: 'Something went wrong. Contact developer for help.' });
      }
    },
  );

  fastify.get(
    '/servers/*',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const episodeId = (request.params as { '*': string })['*'];

      if (typeof episodeId === 'undefined' || episodeId === '')
        return reply.status(400).send({ message: 'episodeId is required' });

      try {
        let res = redis
          ? await cache.fetch(
            redis as Redis,
            `kickassanime:servers:${episodeId}`,
            async () => await kickassanime.fetchEpisodeServers(episodeId),
            REDIS_TTL,
          )
          : await kickassanime.fetchEpisodeServers(episodeId);

        reply.status(200).send(res);
      } catch (err) {
        console.error('Error fetching episode servers:', err);
        console.error('EpisodeId:', episodeId);
        reply
          .status(500)
          .send({ message: 'Something went wrong. Contact developer for help.' });
      }
    },
  );
};

export default routes;
