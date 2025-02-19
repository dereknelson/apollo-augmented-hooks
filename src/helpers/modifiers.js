// Apollo offers no streamlined way to extract the query variables for the cache object we are
// modifying, so this helper has to exist.
const getVariables = (details) => {
    const variableString = (
        details.storeFieldName.match(/\((.+)\)/)?.[1]
        || details.storeFieldName.match(/:(.+)/)?.[1]
    );

    return variableString ? JSON.parse(variableString) : null;
};

// A helper that adds/removes a cache object to/from an array, depending on whether the handler
// returns true or false. Reduces overhead.
const handleIncludeIf = (cache, item, previous, details) => (
    (includeIf) => {
        const next = previous.filter((ref) => details.readField('id', ref) !== item.id);

        if (includeIf) {
            next.push(details.toReference(item));
        }

        return next;
    }
);

let shouldResetReducedQueries = false;

const augmentFields = (cache, item, fields) => {
    const modify = (callback, previous, details) => {
        // Attach a couple additional helpers to apollo's standard details object.
        const callbackResult = callback({
            ...details,
            previous,
            item,
            itemRef: details.toReference(item),
            variables: getVariables(details),
            includeIf: handleIncludeIf(cache, item, previous, details),
        });

        // Since the reduced queries are cached, they need to be notified when the DELETE sentinel
        // object is returned, so that a refetch happens if they include the deleted field. We set
        // the flag here and trigger the respective event after all modifiers have been handled.
        if (callbackResult === details.DELETE) {
            shouldResetReducedQueries = true;
        }

        return callbackResult;
    };

    if (typeof fields === 'function') {
        return (previous, details) => (
            modify(fields, previous, details)
        );
    }

    return Object.entries(fields).reduce((result, [field, modifier]) => ({
        ...result,
        [field]: (previous, details) => (
            modify(modifier, previous, details)
        ),
    }), {});
};

const getCacheIds = (cache, item, cacheObject, typename) => {
    if (!cacheObject && !typename) {
        return ['ROOT_QUERY'];
    }

    if (cacheObject) {
        if (typeof cacheObject === 'function') {
            return [cache.identify(cacheObject(item))];
        }

        return [cache.identify(cacheObject)];
    }

    return Object.keys(cache.extract()).filter((key) => key.startsWith(`${typename}:`));
};

export const handleModifiers = (cache, item, modifiers) => {
    if (!modifiers) {
        return;
    }

    modifiers.forEach(({ cacheObject, typename, fields, evict }) => {
        const cacheIds = getCacheIds(cache, item, cacheObject, typename);

        cacheIds.forEach((cacheId) => {
            if (evict) {
                // Remove the specified cache object from the cache along with all references to it
                // on any other cache objects.
                cache.evict({ id: cacheId });
                cache.gc();
                return;
            }

            try {
                cache.modify({
                    id: cacheId,
                    fields: augmentFields(cache, item, fields),
                });
            } catch (error) {
                // Cache errors are swallowed, so specifically output them to the console.
                /* eslint-disable-next-line no-console */
                console.error(error);
                throw error;
            }
        });
    });

    // If at least one modifier contained a field returning the DELETE sentinel object, cause all
    // active reduced queries to recompute, so that a refetch happens if they include the deleted field.
    if (shouldResetReducedQueries) {
        window.dispatchEvent(new Event('reset-reduced-queries'));
        shouldResetReducedQueries = false;
    }
};
