import{b as d}from"./constants-BMw998OE.js";const c="https://api.linear.app/graphql";async function I(r,t,n={}){const s=await fetch(c,{method:"POST",headers:{"Content-Type":"application/json",Authorization:r},body:JSON.stringify({query:t,variables:n}),signal:AbortSignal.timeout(d)});if(!s.ok)throw new Error(`Linear API HTTP error: ${s.status}`);const e=await s.json();if(e.errors&&e.errors.length>0)throw new Error(`Linear API error: ${e.errors[0].message}`);if(!e.data)throw new Error("Linear API returned no data");return e.data}async function p(r){const t=await chrome.storage.local.get(["linearApiKey","linearTeamId"]),n=t.linearApiKey,s=t.linearTeamId,e=r.teamId||s;if(!n)return{ok:!1,issueId:null,issueUrl:null,issueIdentifier:null,error:"Linear API key not configured — add it in Settings → Integrations"};if(!e)return{ok:!1,issueId:null,issueUrl:null,issueIdentifier:null,error:"No Linear team selected — configure in Settings → Integrations"};const a=`
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          url
          identifier
        }
      }
    }
  `;try{const i=await I(n,a,{input:{title:r.title,description:r.description,teamId:e,priority:r.priority}});if(!i.issueCreate.success)return{ok:!1,issueId:null,issueUrl:null,issueIdentifier:null,error:"Linear issue creation returned success=false"};const{id:o,url:u,identifier:l}=i.issueCreate.issue;return{ok:!0,issueId:o,issueUrl:u,issueIdentifier:l,error:null}}catch(i){return{ok:!1,issueId:null,issueUrl:null,issueIdentifier:null,error:i instanceof Error?i.message:String(i)}}}export{p as createLinearTask};
