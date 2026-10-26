function S_l(A){let e=A.server_model?.model;return"string"==typeof e&&e.length>0?e:"number"==typeof e&&Number.isFinite(e)?String(e):"string"==typeof A.model&&A.model.length>0?A.model:A.key}
