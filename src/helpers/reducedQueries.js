import stringify from 'json-stable-stringify';

const buildFieldName = (selection, variables) => {
    if (!selection.arguments?.length) {
        return selection.name.value;
    }

    const args = selection.arguments.reduce((result, { name, value }) => ({
        ...result,
        // Handle both inline and external veriables
        [name.value]: value.value || variables?.[value.name.value],
    }), {});

    // The field names in apollo's in-memory-cache are built like this:
    //
    // someField
    // someField({"someParam":"someValue"})
    //
    // If there are multiple arguments, they are sorted alphabetically, which is why we use
    // json-stable-stringify here (which guarantees alphabetical order).
    return `${selection.name.value}(${stringify(args)})`;
};

// cacheObjectOrRef may contain either the actual cache object or a reference to it. In the latter
// case, this function returns the actual cache object that is being referenced.
const getCacheObject = (cacheData, cacheObjectOrRef) => {
    const ref = cacheObjectOrRef?.__ref;

    if (ref && cacheData[ref] !== null) {
        return cacheData[ref];
    }

    return cacheObjectOrRef;
};

const isPresentInCache = (cacheData, cacheObjectOrRef, fieldName) => {
    const cacheObject = getCacheObject(cacheData, cacheObjectOrRef);

    // Null means that the cache object exists but contains no data (unlike undefined, which would
    // mean the cache object is missing).
    if (cacheObject === null) {
        return true;
    }

    // The cache object may have been evicted from the cache. So any of its children aren't in the
    // cache either.
    if (cacheObject === undefined) {
        return false;
    }

    return cacheObject[fieldName] !== undefined;
};

const findNextCacheObjectsOrRefs = (cacheData, cacheObjectsOrRefs, fieldName) => (
    cacheObjectsOrRefs.reduce((result, item) => {
        const itemCacheObject = getCacheObject(cacheData, item);
        let fieldData = itemCacheObject[fieldName];

        if (fieldData === null) {
            return result;
        }

        if (!Array.isArray(itemCacheObject[fieldName])) {
            fieldData = [fieldData];
        }

        return [...result, ...fieldData];
    }, [])
);

const filterSubSelections = (selections, cacheData, cacheObjectsOrRefs, variables) => {
    // If there is no cache object or reference, there is no data in the cache for this field, so we
    // keep this part of the query.
    if (cacheObjectsOrRefs === undefined) {
        return selections;
    }

    const reducedSelections = selections.reduce((result, selection) => {
        const fieldName = buildFieldName(selection, variables);

        if (
            // Always keep the id field, otherwise apollo can't merge the cache items after the
            // request is done.
            fieldName === 'id'
            // Keep the entire selection if at least one of its items is not in the cache (it may
            // have been evicted at some point).
            || !cacheObjectsOrRefs.every((item) => isPresentInCache(cacheData, item, fieldName))
        ) {
            return [...result, selection];
        }

        // The current field is not a leaf in the tree, so we may need to go deeper.
        if (selection.selectionSet) {
            // Gather all cache objects or refs of the next level in the tree. Ignore any null
            // values. By not only using a single object as a reference but rather as many like
            // objects as possible, we increase our chances of finding a useful reference for any
            // deeper-level fields.
            const nextCacheObjectsOrRefs = findNextCacheObjectsOrRefs(
                cacheData, cacheObjectsOrRefs, fieldName
            );

            // If we can't find any data for this field in the cache at all, we'll keep the entire
            // selection. This may also be the case if we have already requested this field before,
            // but it has returned null data or empty arrays for every single item.
            if (nextCacheObjectsOrRefs.length === 0) {
                return [...result, selection];
            }

            return handleSubSelections(
                result, selection, cacheData, nextCacheObjectsOrRefs, variables,
            );
        }

        return result;
    }, []);

    // If the reduced selection set is empty or only contains the mandatory id, the cache already
    // contains all the data we need, so we can ignore this selection.
    if (
        reducedSelections.length <= 1
        && (!reducedSelections[0] || reducedSelections[0].name.value === 'id')
    ) {
        return [];
    }

    return reducedSelections;
};

const handleSubSelections = (result, selection, cacheData, cacheObjectsOrRefs, variables) => {
    const subSelections = filterSubSelections(
        selection.selectionSet.selections,
        cacheData,
        cacheObjectsOrRefs,
        variables,
    );

    if (subSelections.length === 0) {
        return result;
    }

    return [
        ...result,
        {
            ...selection,
            selectionSet: {
                ...selection.selectionSet,
                selections: subSelections,
            },
        },
    ];
};

const hasVariable = (selectionSet, variable) => (
    (selectionSet?.selections || []).some((selection) => (
        selection.arguments.some(({ value }) => value?.name?.value === variable)
        || hasVariable(selection.selectionSet, variable)
    ))
);

export const makeReducedQueryAst = (cache, queryAst, variables) => {
    const cacheContents = cache.extract();

    // Recursively iterate through the entire graphql query tree, removing the fields for which we
    // already have data in the cache.
    const selections = (
        queryAst.definitions[0].selectionSet.selections.reduce((result, selection) => {
            const fieldName = buildFieldName(selection, variables);
            let cacheObjectsOrRefs = cacheContents.ROOT_QUERY?.[fieldName];

            if (cacheObjectsOrRefs === undefined) {
                // If the field cannot be found in the cache, keep the entire selection.
                return [...result, selection];
            }

            if (!Array.isArray(cacheObjectsOrRefs)) {
                cacheObjectsOrRefs = [cacheObjectsOrRefs];
            }

            return handleSubSelections(
                result,
                selection,
                cacheContents,
                cacheObjectsOrRefs,
                variables
            );
        }, [])
    );
    // Construct a new tree from the reduced selection set.
    const definition = queryAst.definitions[0];
    const selectionSet = {
        ...definition.selectionSet,
        selections,
    };
    const reducedQueryAst = {
        ...queryAst,
        definitions: [{
            ...definition,
            name: {
                kind: 'Name',
                // Prefix the query name with something that clearly marks it as manipulated.
                value: `__REDUCED__${definition.name?.value || ''}`,
            },
            selectionSet,
            // Remove variable definitions that are no longer referenced anywhere in the selection
            // set.
            variableDefinitions: definition.variableDefinitions.filter(({ variable }) => (
                hasVariable(selectionSet, variable.name.value)
            )),
        }],
    };

    // If the reduced query happens to have no more selections because everything is already
    // available in the cache, simply return the original query. Apollo will fetch everything from
    // the cache by itself rather than make a request to the server.
    if (reducedQueryAst.definitions[0].selectionSet.selections.length === 0) {
        return queryAst;
    }

    return reducedQueryAst;
};
