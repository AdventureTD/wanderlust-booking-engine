export async function findAll(query, options) {
  const items = [];
  let page = await query.limit(1000).find(options || { suppressAuth: true, consistentRead: true });
  while (page) {
    items.push.apply(items, page.items || []);
    if (!page.hasNext || !page.hasNext()) break;
    page = await page.next();
  }
  return items;
}
