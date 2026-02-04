/**
 * Shared pagination utilities for API endpoints.
 * 
 * Uses cursor-based pagination for stable, efficient pagination.
 */

export interface PaginationParams {
    cursor?: string;
    take: number;
    category?: string;
}

export interface PaginationMeta {
    nextCursor: string | null;
    hasMore: boolean;
    total?: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    pagination: PaginationMeta;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Parse pagination parameters from URL search params.
 */
export function parsePaginationParams(
    searchParams: URLSearchParams
): PaginationParams {
    const cursor = searchParams.get("cursor") ?? undefined;
    const category = searchParams.get("category") ?? undefined;

    let take = parseInt(searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE), 10);

    // Validate and clamp
    if (isNaN(take) || take < 1) {
        take = DEFAULT_PAGE_SIZE;
    }
    take = Math.min(take, MAX_PAGE_SIZE);

    return { cursor, take, category };
}

/**
 * Build pagination metadata from query results.
 * 
 * @param items - Items fetched (should be take + 1 to check hasMore)
 * @param take - Requested page size
 * @param getItemId - Function to get ID from item for cursor
 * @param total - Optional total count
 */
export function buildPaginationMeta<T>(
    items: T[],
    take: number,
    getItemId: (item: T) => string,
    total?: number
): { data: T[]; pagination: PaginationMeta } {
    const hasMore = items.length > take;
    const data = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore && data.length > 0
        ? getItemId(data[data.length - 1])
        : null;

    return {
        data,
        pagination: {
            nextCursor,
            hasMore,
            ...(total !== undefined && { total }),
        },
    };
}
