import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getGameById,
    getGamesByCategory,
    getGamesByPublisher,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

async function seedFilteredGames(db: Database): Promise<void> {
    const [strategy] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [puzzle] = await db
        .insert(categories)
        .values({ name: 'Puzzle', description: 'cat' })
        .returning({ id: categories.id });
    const [pubOne] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });
    const [pubTwo] = await db
        .insert(publishers)
        .values({ name: 'Pub Two', description: 'pub' })
        .returning({ id: publishers.id });

    await db.insert(games).values([
        { title: 'Alpha Plan', description: 'Strategy / Pub One', starRating: 4.2, categoryId: strategy.id, publisherId: pubOne.id },
        { title: 'Beta Plan', description: 'Strategy / Pub Two', starRating: 4.5, categoryId: strategy.id, publisherId: pubTwo.id },
        { title: 'Gamma Puzzle', description: 'Puzzle / Pub One', starRating: 3.8, categoryId: puzzle.id, publisherId: pubOne.id },
    ]);
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('filters games by category names and ids', async () => {
        await seedFilteredGames(db);

        const byName = await getGamesByCategory(db, 'Strategy');
        const byId = await getGamesByCategory(db, [1]);

        expect(byName.map((game) => game.title)).toEqual(['Alpha Plan', 'Beta Plan']);
        expect(byId.map((game) => game.title)).toEqual(['Alpha Plan', 'Beta Plan']);
    });

    it('combines category and publisher filters', async () => {
        await seedFilteredGames(db);

        const filtered = await getAllGames(db, {
            categories: ['Strategy'],
            publishers: ['Pub One'],
        });

        expect(filtered.map((game) => game.title)).toEqual(['Alpha Plan']);
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('filters games by publisher names and ids', async () => {
        await seedFilteredGames(db);

        const byName = await getGamesByPublisher(db, 'Pub One');
        const byId = await getGamesByPublisher(db, [1]);

        expect(byName.map((game) => game.title)).toEqual(['Alpha Plan', 'Gamma Puzzle']);
        expect(byId.map((game) => game.title)).toEqual(['Alpha Plan', 'Gamma Puzzle']);
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});
