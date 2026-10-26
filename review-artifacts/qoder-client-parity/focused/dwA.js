function dwA(A,e=!1,t){let i=[],r=t?.supportsVision??!0,n=jqi(qft(A),e);for(let A of n)switch(A.role){case"user":i.push(...Uzl(A,r));break;case"assistant":i.push(...Nzl(A))}return i}
