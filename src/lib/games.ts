import { eq, asc, inArray, and } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Game } from '../types/game';

export type GameFilterOptions = {
    categories?: Array<number | string> | number | string | null;
    publishers?: Array<number | string> | number | string | null;
};

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function normalizeFilterValues(values: GameFilterOptions['categories'] | GameFilterOptions['publishers']): Array<number | string> {
    if (values === null || values === undefined) {
        return [];
    }

    if (Array.isArray(values)) {
        return values.flatMap((value) => {
            if (value === null || value === undefined) {
                return [];
            }

            const normalized = String(value).trim();
            return normalized === '' ? [] : [value];
        });
    }

    const normalized = String(values).trim();
    return normalized === '' ? [] : [values];
}

function buildFilterPredicate(
    idColumn: typeof categories.id | typeof publishers.id,
    nameColumn: typeof categories.name | typeof publishers.name,
    values: Array<number | string>,
) {
    const ids = values.filter((value): value is number => typeof value === 'number');
    const names = values
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
        .map((value) => value.trim());

    if (ids.length === 0 && names.length === 0) {
        return undefined;
    }

    const clauses = [];
    if (ids.length > 0) {
        clauses.push(inArray(idColumn, ids));
    }
    if (names.length > 0) {
        clauses.push(inArray(nameColumn, names));
    }

    return clauses.length === 1 ? clauses[0] : and(...clauses);
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

/**
 * Return every game in title order, optionally narrowed to a set of selected categories and publishers.
 *
 * @param db - The real SQLite database or an in-memory test database.
 * @param filters - Optional category and publisher filters using category IDs, category names, publisher IDs, or publisher names.
 * @returns All matching games with their related category and publisher metadata attached.
 */
export async function getAllGames(db: Database, filters: GameFilterOptions = {}): Promise<Game[]> {
    const query = baseGamesQuery(db);
    const predicates = [
        buildFilterPredicate(categories.id, categories.name, normalizeFilterValues(filters.categories)),
        buildFilterPredicate(publishers.id, publishers.name, normalizeFilterValues(filters.publishers)),
    ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

    const rows = predicates.length > 0 ? await query.where(and(...predicates)).orderBy(asc(games.title)) : await query.orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Return all games within the selected category names or IDs.
 *
 * @param db - The real SQLite database or an in-memory test database.
 * @param categories - One or more category names or IDs to include.
 * @returns Matching games with their publisher information attached.
 */
export async function getGamesByCategory(db: Database, categoriesFilter: Array<number | string> | number | string): Promise<Game[]> {
    return getAllGames(db, { categories: categoriesFilter });
}

/**
 * Return all games within the selected publisher names or IDs.
 *
 * @param db - The real SQLite database or an in-memory test database.
 * @param publishersFilter - One or more publisher names or IDs to include.
 * @returns Matching games with their category information attached.
 */
export async function getGamesByPublisher(db: Database, publishersFilter: Array<number | string> | number | string): Promise<Game[]> {
    return getAllGames(db, { publishers: publishersFilter });
}

/**
 * Return every category in alphabetical order for the filter UI.
 *
 * @param db - The real SQLite database or an in-memory test database.
 * @returns Categories sorted by name.
 */
export async function getAllCategories(db: Database): Promise<Array<{ id: number; name: string }>> {
    return db.select().from(categories).orderBy(asc(categories.name));
}

/**
 * Return every publisher in alphabetical order for the filter UI.
 *
 * @param db - The real SQLite database or an in-memory test database.
 * @returns Publishers sorted by name.
 */
export async function getAllPublishers(db: Database): Promise<Array<{ id: number; name: string }>> {
    return db.select().from(publishers).orderBy(asc(publishers.name));
}

/** All game ids ordered by title. */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/** A single game by id, or null when it does not exist. */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
