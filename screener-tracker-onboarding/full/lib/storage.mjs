import { createClient } from "@supabase/supabase-js";
import { validateCompany } from "./contract.mjs";
export function createStorage() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw Error("Supabase URL and service role key are required");
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const bucket = "screener-charts";
  return {
    async initialize() {
      const { data, error } = await client.storage.getBucket(bucket);
      if (error) {
        const result = await client.storage.createBucket(bucket, {
          public: true,
          allowedMimeTypes: ["image/png"],
          fileSizeLimit: 5242880,
        });
        if (result.error)
          throw Error("Cannot create chart bucket: " + result.error.message);
      } else if (!data.public) throw Error("Chart bucket must be public");
    },
    async save({ data, images }, id, symbol) {
      validateCompany(data, symbol);
      for (const range of ["1y", "3y", "5y", "max"]) {
        const image = images[range];
        if (
          !image ||
          image.length < 1000 ||
          image.readUInt32BE(0) !== 0x89504e47
        )
          throw Error("Invalid PNG chart " + range);
        const path = `${id}/${encodeURIComponent(symbol)}/${range}.png`;
        const { error } = await client.storage
          .from(bucket)
          .upload(path, image, { contentType: "image/png", upsert: true });
        if (error) throw Error("Chart upload failed: " + error.message);
        data.chart_snapshots[range].image = client.storage
          .from(bucket)
          .getPublicUrl(path).data.publicUrl;
      }
      return validateCompany(data, symbol);
    },
  };
}
