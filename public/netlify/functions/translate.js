exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'XAI_API_KEY 환경 변수가 설정되지 않았습니다.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: '잘못된 요청 본문입니다.' }) };
  }

  const { base64Data, mediaType, targetLang } = payload;
  if (!base64Data || !mediaType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'base64Data와 mediaType이 필요합니다.' }) };
  }

  const lang = targetLang || '한국어';

  const systemPrompt = `당신은 만화/일러스트 이미지 속 텍스트를 OCR하고 번역한 뒤, 원문 위치에 다시 그려 넣을 수 있도록 좌표 정보를 제공하는 도구입니다.
이미지 속 모든 텍스트(말풍선, 나레이션, 효과음 포함)를 찾아 각각에 대해:
- original: 원문 텍스트
- translation: ${lang}로 번역한 텍스트
- bbox: 이미지 전체 크기를 1x1로 봤을 때 텍스트 영역의 [x, y, width, height] (0~1 사이 소수, x/y는 좌상단 기준)

반드시 아래 JSON 형식으로만 응답하세요. 다른 설명이나 코드블록 표시 없이 순수 JSON만 출력합니다.
{ "bubbles": [ { "original": "", "translation": "", "bbox": [0,0,0,0] } ] }
텍스트가 없으면 bubbles를 빈 배열로 응답하세요.`;

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-4.3',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}` } },
              { type: 'text', text: '이 이미지의 텍스트를 OCR하고 번역 + 좌표(JSON)로만 응답해.' }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: 'xAI API 오류', detail: errText }) };
    }

    const data = await response.json();
    const messageContent = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!messageContent) {
      return { statusCode: 502, body: JSON.stringify({ error: '빈 응답을 받았습니다.' }) };
    }

    let clean = messageContent
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: '모델 응답을 JSON으로 해석하지 못했습니다.', raw: clean }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
