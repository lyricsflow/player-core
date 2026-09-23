/**
 * Lyricsflow — Apple Music AMP API Parser
 * @license AGPL-3.0
 * High-performance, zero-dependency parser utility for Apple Music's internal AMP API
 * and JSON:API responses with `format[resources]=map`.
 */

/**
 * @typedef {Object} ArtworkOptions
 * @property {number} [width=300] - Desired width
 * @property {number} [height=300] - Desired height
 * @property {string} [format='jpg'] - File format ('jpg', 'png', 'webp')
 * @property {string} [crop=''] - Crop parameter ('bb', 'cc', or empty)
 */

/**
 * Resolves dynamic Apple Music artwork URL templates ({w}x{h}{c}.{f}) into real image URLs.
 *
 * @param {string|Object} artwork - Raw artwork object or template string
 * @param {ArtworkOptions} [options={}] - Formatting options
 * @returns {string} Fully resolved image URL
 */
export function resolveArtworkUrl(artwork, options = {}) {
  const urlTemplate = typeof artwork === 'string' ? artwork : (artwork?.url || artwork?.artwork?.url || '');
  if (!urlTemplate || typeof urlTemplate !== 'string') return '';

  const width = options.width || 300;
  const height = options.height || 300;
  const format = options.format || (urlTemplate.includes('Logo') || /\.png(?:\/|$)/i.test(urlTemplate) ? 'png' : 'jpg');
  const crop = options.crop !== undefined ? options.crop : (urlTemplate.includes('{c}') ? 'bb' : '');

  let resolved = urlTemplate
    .replace('{w}', String(width))
    .replace('{h}', String(height))
    .replace('{c}', crop)
    .replace('{f}', format);

  // If URL already had static dimensions like 100x100bb, update to target dimensions
  if (width > 100 && /\/\d+x\d+(?:bb)?\./.test(resolved)) {
    resolved = resolved.replace(/\/\d+x\d+(?:bb)?\./, `/${width}x${height}${crop ? crop : 'bb'}.`);
  }

  if (!/^https?:\/\//i.test(resolved)) return '';
  return resolved.replace(/["'<>\s]/g, (c) => encodeURIComponent(c));
}

/**
 * Parses raw Apple Music AMP API response (with `format[resources]=map`)
 * and returns a normalized, fully dereferenced frontend-friendly object.
 *
 * @param {Object} rawResponse - The raw JSON response from Apple Music AMP API
 * @returns {Object} Normalized data with dereferenced items and resources
 */
export function parseAmpResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'object') {
    return { data: [], results: {}, resources: {} };
  }

  const rawResources = rawResponse.resources || {};
  const entityMap = new Map(); // Key: `${type}:${id}` -> Dereferenced Entity

  // 1. First Pass: Create flat shell objects for every resource
  for (const [type, typeGroup] of Object.entries(rawResources)) {
    if (!typeGroup || typeof typeGroup !== 'object') continue;

    for (const [id, entity] of Object.entries(typeGroup)) {
      if (!entity || typeof entity !== 'object') continue;

      const key = `${type}:${id}`;
      const attributes = entity.attributes || {};
      const relationships = entity.relationships || {};
      const views = entity.views || {};
      const meta = entity.meta || {};

      // Flatten attributes onto root entity for clean, direct frontend consumption
      const flatEntity = {
        id: entity.id || id,
        type: entity.type || type,
        href: entity.href || '',
        ...attributes,
        attributes,
        rawRelationships: relationships,
        relationships: {},
        views: {},
        meta,
        _raw: entity
      };

      // Artwork helper bound directly to the entity
      flatEntity.getArtwork = (w = 300, h = 300, f = null) => {
        return resolveArtworkUrl(attributes.artwork || attributes.editorialArtwork, {
          width: w,
          height: h,
          format: f
        });
      };

      entityMap.set(key, flatEntity);
    }
  }

  // 2. Second Pass: Dereference relationships and views recursively (with visited guards)
  function dereferenceRelation(item, visited = new Set()) {
    if (!item || typeof item !== 'object') return item;

    const id = item.id;
    const type = item.type;
    if (!id || !type) return item;

    const key = `${type}:${id}`;
    if (visited.has(key)) {
      // Circular reference break: return shallow placeholder
      const cached = entityMap.get(key);
      return cached ? { id: cached.id, type: cached.type, name: cached.name || cached.title } : item;
    }

    const resolved = entityMap.get(key);
    if (!resolved) return item;

    return resolved;
  }

  for (const [key, entity] of entityMap.entries()) {
    const visited = new Set([key]);

    // Dereference relationships
    if (entity.rawRelationships) {
      for (const [relName, relValue] of Object.entries(entity.rawRelationships)) {
        if (!relValue || typeof relValue !== 'object') continue;

        const relData = relValue.data;
        if (Array.isArray(relData)) {
          entity.relationships[relName] = relData.map((ref) => dereferenceRelation(ref, visited));
        } else if (relData && typeof relData === 'object') {
          entity.relationships[relName] = dereferenceRelation(relData, visited);
        } else {
          entity.relationships[relName] = relValue;
        }
      }
    }

    // Dereference views
    if (entity._raw?.views) {
      for (const [viewName, viewValue] of Object.entries(entity._raw.views)) {
        if (!viewValue || typeof viewValue !== 'object') continue;

        const viewData = viewValue.data;
        if (Array.isArray(viewData)) {
          entity.views[viewName] = viewData.map((ref) => dereferenceRelation(ref, visited));
        } else if (viewData && typeof viewData === 'object') {
          entity.views[viewName] = dereferenceRelation(viewData, visited);
        } else {
          entity.views[viewName] = viewValue;
        }
      }
    }
  }

  // 3. Resolve Root `data` Array / Primary Entities
  let parsedData = [];
  if (Array.isArray(rawResponse.data)) {
    parsedData = rawResponse.data.map((item) => {
      const key = `${item.type}:${item.id}`;
      return entityMap.get(key) || item;
    });
  } else if (rawResponse.data && typeof rawResponse.data === 'object') {
    const key = `${rawResponse.data.type}:${rawResponse.data.id}`;
    parsedData = [entityMap.get(key) || rawResponse.data];
  }

  // 4. Resolve `results` (e.g. for /search queries)
  const parsedResults = {};
  if (rawResponse.results && typeof rawResponse.results === 'object') {
    for (const [groupName, groupObj] of Object.entries(rawResponse.results)) {
      if (!groupObj || typeof groupObj !== 'object') {
        parsedResults[groupName] = groupObj;
        continue;
      }

      const groupData = groupObj.data;
      if (Array.isArray(groupData)) {
        parsedResults[groupName] = {
          ...groupObj,
          data: groupData.map((ref) => {
            const key = `${ref.type}:${ref.id}`;
            return entityMap.get(key) || ref;
          })
        };
      } else {
        parsedResults[groupName] = groupObj;
      }
    }
  }

  // Build grouped normalized resource lookup
  const normalizedResources = {};
  for (const [key, entity] of entityMap.entries()) {
    const [type, id] = key.split(':');
    if (!normalizedResources[type]) normalizedResources[type] = {};
    normalizedResources[type][id] = entity;
  }

  return {
    data: parsedData,
    results: parsedResults,
    resources: normalizedResources,
    meta: rawResponse.meta || {}
  };
}

export default {
  resolveArtworkUrl,
  parseAmpResponse
};
