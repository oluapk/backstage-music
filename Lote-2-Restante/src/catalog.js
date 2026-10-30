const requiredColumns = ['id', 'title', 'artist', 'album', 'object_path', 'license', 'created_at'];
const optionalColumns = ['cover_path', 'duration_seconds', 'content_type'];

export async function loadPublishedTracks(client) {
  let columns = [...requiredColumns, ...optionalColumns];
  for (let attempt = 0; attempt <= optionalColumns.length; attempt += 1) {
    const tracks = new Map();
    let result;
    for (let offset = 0; ; offset += 1000) {
      result = await client.from('tracks')
        .select(columns.join(', '))
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + 999);
      if (result.error) break;
      for (const track of result.data || []) tracks.set(String(track.id), track);
      if (!result.data || result.data.length < 1000) return { ...result, data: [...tracks.values()] };
    }
    const error = result.error;
    const missingColumn = ['42703', 'PGRST204'].includes(error?.code)
      ? optionalColumns.find(column => columns.includes(column) && error.message?.includes(column))
      : null;
    if (!missingColumn) return result;
    columns = columns.filter(column => column !== missingColumn);
  }
}
