import { ApolloClient, InMemoryCache, gql } from '@apollo/client';
import { print } from 'graphql/language/printer';
import { makeReducedQueryAst } from './reducedQueries';

const cache = new InMemoryCache();
const client = new ApolloClient({ cache });

const compare = (reducedQueryAst, actualQuery) => {
    const received = print(reducedQueryAst).replace(/\s+/g, ' ').trim();
    const expected = actualQuery.replace(/\s+/g, ' ').trim();

    expect(received).toBe(expected);
};

afterEach(() => {
    client.resetStore();
});

it('removes fields that are already in the cache', () => {
    const queryInCache = `
        query {
            thing {
                id
                name
                description
            }
        }
    `;
    const requestedQuery = `
        query {
            thing {
                id
                name
                description
                age
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__ {
            thing {
                id
                age
            }
        }
    `;

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            thing: {
                __typename: 'Thing',
                id: 'some-id',
                name: 'some-name',
                description: 'some-description',
            },
        },
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery));

    compare(reducedQueryAst, actualQuery);
});

it('removes fields arbitrarily deep', () => {
    const queryInCache = `
        query {
            thing {
                id
                name
                description
                thing {
                    id
                    name
                    description
                    thing {
                        id
                        name
                        description
                    }
                }
            }
        }
    `;
    const requestedQuery = `
        query {
            thing {
                id
                name
                description
                age
                thing {
                    id
                    name
                    description
                    age
                    thing {
                        id
                        name
                        description
                    }
                }
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__ {
            thing {
                id
                age
                thing {
                    id
                    age
                }
            }
        }
    `;

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            thing: {
                __typename: 'Thing',
                id: 'some-id',
                name: 'some-name',
                description: 'some-description',
                thing: {
                    __typename: 'Thing',
                    id: 'some-id-2',
                    name: 'some-name-2',
                    description: 'some-description-2',
                    thing: {
                        __typename: 'Thing',
                        id: 'some-id-3',
                        name: 'some-name-3',
                        description: 'some-description-3',
                    },
                },
            },
        },
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery));

    compare(reducedQueryAst, actualQuery);
});

it('keeps fields when using arrays if at least one array item is missing the field in the cache', () => {
    const queryInCache = `
        query {
            things {
                id
                name
                description
            }
        }
    `;
    const requestedQuery = `
        query {
            things {
                id
                name
                description
                age
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__ {
            things {
                id
                age
            }
        }
    `;

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            things: [{
                __typename: 'Thing',
                id: 'some-id',
                name: 'some-name',
                description: 'some-description',
                age: 'some-age',
            }, {
                __typename: 'Thing',
                id: 'some-id',
                name: 'some-name',
                description: 'some-description',
            }],
        },
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery));

    compare(reducedQueryAst, actualQuery);
});

it('removes fields arbitrarily deep when using arrays', () => {
    const queryInCache = `
        query {
            things {
                id
                name
                description
                thing {
                    id
                    name
                    description
                    things {
                        id
                        name
                        description
                    }
                }
            }
        }
    `;
    const requestedQuery = `
        query {
            things {
                id
                name
                description
                age
                thing {
                    id
                    name
                    description
                    age
                    things {
                        id
                        name
                        description
                    }
                }
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__ {
            things {
                id
                age
                thing {
                    id
                    age
                }
            }
        }
    `;

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            things: [{
                __typename: 'Thing',
                id: 'some-id',
                name: 'some-name',
                description: 'some-description',
                thing: {
                    __typename: 'Thing',
                    id: 'some-id-2',
                    name: 'some-name-2',
                    description: 'some-description-2',
                    things: [{
                        __typename: 'Thing',
                        id: 'some-id-3',
                        name: 'some-name-3',
                        description: 'some-description-3',
                    }],
                },
            }],
        },
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery));

    compare(reducedQueryAst, actualQuery);
});

it('keeps fields if no array item in the cache contains useful data to continue traversing', () => {
    const queryInCache = `
        query {
            thing {
                id
                things {
                    id
                    thing {
                        id
                        name
                    }
                }
            }
        }
    `;
    const requestedQuery = `
        query {
            thing {
                id
                things {
                    id
                    name
                    thing {
                        id
                        name
                        thing {
                            id
                        }
                    }
                }
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__ {
            thing {
                id
                things {
                    id
                    name
                    thing {
                        id
                        name
                        thing {
                            id
                        }
                    }
                }
            }
        }
    `;

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            thing: {
                __typename: 'Thing',
                id: 'some-id',
                things: [{
                    __typename: 'Thing',
                    id: 'some-id-2',
                    thing: null,
                }, {
                    __typename: 'Thing',
                    id: 'some-id-3',
                    thing: null,
                }],
            },
        },
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery));

    compare(reducedQueryAst, actualQuery);
});

it('keeps fields if it exists in the cache but the value is null', () => {
    const queryInCache = `
        query {
            thing {
                id
                name
                description
            }
        }
    `;
    const requestedQuery = `
        query {
            thing {
                id
                name
                description
            }
        }
    `;
    const actualQuery = `
        {
            thing {
                id
                name
                description
            }
        }
    `;

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            thing: null,
        },
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery));

    compare(reducedQueryAst, actualQuery);
});

it('removes fields if the same variables are used', () => {
    const queryInCache = `
        query test($filter: Filter) {
            things(filter: $filter) {
                id
                name
            }
        }
    `;
    const requestedQuery = `
        query test($filter: Filter) {
            things(filter: $filter) {
                id
                name
                description
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__test($filter: Filter) {
            things(filter: $filter) {
                id
                description
            }
        }
    `;
    const variables = {
        filter: {
            someFilter: 'some-value',
        },
    };

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            things: [{
                id: 'some-id',
                name: 'some-name',
            }],
        },
        variables,
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery), variables);

    compare(reducedQueryAst, actualQuery);
});

it('keeps fields if different variables are used', () => {
    const queryInCache = `
        query test($filter: Filter) {
            things(filter: $filter) {
                id
                name
            }
        }
    `;
    const requestedQuery = `
        query test($filter: Filter) {
            things(filter: $filter) {
                id
                name
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__test($filter: Filter) {
            things(filter: $filter) {
                id
                name
            }
        }
    `;
    const variablesInCache = {
        filter: {
            someFilter: 'some-value',
        },
    };
    const requestedVariables = {
        filter: {
            someFilter: 'some-other-value',
        },
    };

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            things: [{
                id: 'some-id',
                name: 'some-name',
            }],
        },
        variables: variablesInCache,
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery), requestedVariables);

    compare(reducedQueryAst, actualQuery);
});

it('removes fields if the same inline variables are used', () => {
    const queryInCache = `
        query {
            things(filter: "some-value") {
                id
                name
            }
        }
    `;
    const requestedQuery = `
        query {
            things(filter: "some-value") {
                id
                name
                description
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__ {
            things(filter: "some-value") {
                id
                description
            }
        }
    `;

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            things: [{
                id: 'some-id',
                name: 'some-name',
            }],
        },
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery));

    compare(reducedQueryAst, actualQuery);
});

it('returns the same query if all the requested data is in the cache', () => {
    const queryInCache = `
        query {
            thing {
                id
                name
                description
            }
        }
    `;
    const requestedQuery = queryInCache;

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            thing: {
                __typename: 'Thing',
                id: 'some-id',
                name: 'some-name',
                description: 'some-description',
            },
        },
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery));

    expect(reducedQueryAst).toEqual(gql(requestedQuery));
});

it('has the expected result in a complex query', () => {
    const queryInCache = `
        query test($a: A, $b: B, $c: C) {
            inCache {
                id
                name
                inCacheSub {
                    id
                    name
                }
                inCacheSubWithVars(a: $a) {
                    id
                    name
                }
            }
            inCacheWithVars(bDifferentName: $b) {
                id
                name
                inCacheWithVarsSub {
                    id
                    name
                }
                inCacheWithVarsSubWithVars(c: $c) {
                    id
                    name
                }
            }
        }
    `;
    const requestedQuery = `
        query test($a: A, $b: B, $c: C) {
            inCache {
                id
                name
                inCacheSub {
                    id
                    name
                }
                inCacheSubWithVars(a: $a) {
                    id
                    name
                    inCacheSubWithVarsSubNotInCache {
                        id
                        name
                    }
                }
                inCacheSubNotInCache {
                    id
                    name
                }
            }
            inCacheWithVars(bDifferentName: $b) {
                id
                name
                inCacheWithVarsSub {
                    id
                    name
                }
                inCacheWithVarsSubWithVars(c: $c) {
                    id
                    name
                }
            }
            notInCache {
                id
                name
            }
        }
    `;
    const actualQuery = `
        query __REDUCED__test($a: A, $b: B, $c: C) {
            inCache {
                id
                inCacheSubWithVars(a: $a) {
                    id
                    inCacheSubWithVarsSubNotInCache {
                        id
                        name
                    }
                }
                inCacheSubNotInCache {
                    id
                    name
                }
            }
            inCacheWithVars(bDifferentName: $b) {
                id
                inCacheWithVarsSubWithVars(c: $c) {
                    id
                    name
                }
            }
            notInCache {
                id
                name
            }
        }
    `;
    const variablesInCache = {
        a: 'a',
        b: 'b',
        c: 'c',
    };
    const requestedVariables = {
        a: 'a',
        b: 'b',
        c: 'c-altered',
    };

    cache.writeQuery({
        query: gql(queryInCache),
        data: {
            inCache: {
                id: 'some-id',
                name: 'some-name',
                inCacheSub: [{
                    id: 'some-id-2',
                    name: 'some-name-2',
                }],
                inCacheSubWithVars: {
                    id: 'some-id-3',
                    name: 'some-name-3',
                },
            },
            inCacheWithVars: [{
                id: 'some-id-4',
                name: 'some-name-4',
                inCacheWithVarsSub: {
                    id: 'some-id-5',
                    name: 'some-name-5',
                },
                inCacheWithVarsSubWithVars: [{
                    id: 'some-id-6',
                    name: 'some-name-6',
                }],
            }],
        },
        variables: variablesInCache,
    });

    const reducedQueryAst = makeReducedQueryAst(cache, gql(requestedQuery), requestedVariables);

    compare(reducedQueryAst, actualQuery);
});
