export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return new Response("Only POST allowed", { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const msg = body.messages && body.messages[0] ? body.messages[0].content : "";

      // HTML se do tarah ka content aa sakta hai: seedha text (string), ya array (text + image, photo search ke liye)
      const parts = [];
      if (typeof msg === "string") {
        parts.push({ text: msg });
      } else if (Array.isArray(msg)) {
        for (const item of msg) {
          if (item.type === "text") {
            parts.push({ text: item.text });
          } else if (item.type === "image") {
            parts.push({
              inline_data: {
                mime_type: item.source.media_type || "image/jpeg",
                data: item.source.data,
              },
            });
          }
        }
      }

      const geminiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
          }),
        }
      );

      const data = await geminiResp.json();
      const text =
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0]
          ? data.candidates[0].content.parts[0].text
          : "[]";

      // Anthropic jaisa hi response shape banaya, taaki website ka code bina badle chale
      return new Response(
        JSON.stringify({ content: [{ type: "text", text }] }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
  },
};
