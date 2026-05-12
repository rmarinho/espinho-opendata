export function validateUpdateSchema(data) {
  const errors = [];

  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const isIsoDateTimeLike = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));
  const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//.test(value);

  if (!isObject(data)) {
    errors.push('Root payload must be an object.');
    return errors;
  }

  const requiredRootKeys = ['date', 'generatedAt', 'title', 'facebookDraft', 'updates', 'sources', 'checkedSources', 'noSignificantUpdates'];
  for (const key of requiredRootKeys) {
    if (!(key in data)) errors.push(`Missing root key: ${key}`);
  }

  if (!isIsoDate(data.date)) errors.push('date must match YYYY-MM-DD.');
  if (!isIsoDateTimeLike(data.generatedAt)) errors.push('generatedAt must be a valid ISO datetime string.');
  if (typeof data.title !== 'string') errors.push('title must be a string.');
  if (typeof data.facebookDraft !== 'string') errors.push('facebookDraft must be a string.');
  if (typeof data.noSignificantUpdates !== 'boolean') errors.push('noSignificantUpdates must be a boolean.');

  if (!Array.isArray(data.updates)) {
    errors.push('updates must be an array.');
  } else {
    if (data.updates.length > 7) {
      errors.push('updates must have at most 7 entries.');
    }

    for (const [index, item] of data.updates.entries()) {
      if (!isObject(item)) {
        errors.push(`updates[${index}] must be an object.`);
        continue;
      }

      for (const key of ['topic', 'text', 'dateTime', 'location', 'sources']) {
        if (!(key in item)) errors.push(`updates[${index}] missing key: ${key}`);
      }

      if (typeof item.topic !== 'string') errors.push(`updates[${index}].topic must be a string.`);
      if (typeof item.text !== 'string') errors.push(`updates[${index}].text must be a string.`);
      if (!isIsoDateTimeLike(item.dateTime)) errors.push(`updates[${index}].dateTime must be valid ISO datetime.`);
      if (typeof item.location !== 'string') errors.push(`updates[${index}].location must be a string.`);
      if (!Array.isArray(item.sources)) {
        errors.push(`updates[${index}].sources must be an array.`);
      } else if (item.sources.some((source) => !isHttpUrl(source))) {
        errors.push(`updates[${index}].sources must contain only http(s) URLs.`);
      }
    }
  }

  if (!Array.isArray(data.sources)) {
    errors.push('sources must be an array.');
  } else {
    for (const [index, source] of data.sources.entries()) {
      if (!isObject(source)) {
        errors.push(`sources[${index}] must be an object.`);
        continue;
      }

      for (const key of ['title', 'url', 'publisher']) {
        if (!(key in source)) errors.push(`sources[${index}] missing key: ${key}`);
      }

      if (typeof source.title !== 'string') errors.push(`sources[${index}].title must be a string.`);
      if (!isHttpUrl(source.url)) errors.push(`sources[${index}].url must be a valid http(s) URL.`);
      if (typeof source.publisher !== 'string') errors.push(`sources[${index}].publisher must be a string.`);
    }
  }

  if (!Array.isArray(data.checkedSources)) {
    errors.push('checkedSources must be an array.');
  } else if (data.checkedSources.some((source) => !isHttpUrl(source))) {
    errors.push('checkedSources must contain only http(s) URLs.');
  }

  return errors;
}

export function assertValidUpdateSchema(data) {
  const errors = validateUpdateSchema(data);
  if (errors.length) {
    throw new Error(`Generated JSON does not match required schema:\n- ${errors.join('\n- ')}`);
  }
}
