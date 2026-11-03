function afu(t){return t.toolMessages.map(e=>({toolUseId:e.tool_call_id,content:[{text:fFe(e.content)}],status:e.additional_kwargs.success===!1?"error":"success"}))};
