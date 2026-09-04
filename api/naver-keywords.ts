import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { accessLicense, secretKey, customerId, keywords } = req.body;
  if (!accessLicense || !secretKey || !customerId || !keywords?.length)
    return res.status(400).json({ error: "accessLicense, secretKey, customerId, keywords 필요" });

  try {
    const timestamp = Date.now().toString();
    const message = `${timestamp}.GET./keywordstool`;
    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(message)
      .digest("base64");

    const url = `https://api.naver.com/keywordstool?hintKeywords=${encodeURIComponent(
      keywords.join(",")
    )}&showDetail=1`;

    const r = await fetch(url, {
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": accessLicense,
        "X-Customer": customerId,
        "X-Signature": signature,
      },
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: `네이버 API 오류 ${r.status}: ${txt}` });
    }

    const data = await r.json();
    return res.json(data);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

