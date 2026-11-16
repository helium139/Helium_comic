import {createRemoteJWKSet,jwtVerify} from 'jose';
const keys=createRemoteJWKSet(new URL('https://firebaseappcheck.googleapis.com/v1/jwks'));
export async function verifyAppCheck(token,{projectNumber,appId,keySet=keys}){
 if(!/^\d+$/.test(projectNumber||'')||!appId||!token)throw Error('App Check configuration/token missing');
 const {payload,protectedHeader}=await jwtVerify(token,keySet,{algorithms:['RS256'],issuer:`https://firebaseappcheck.googleapis.com/${projectNumber}`,audience:`projects/${projectNumber}`,requiredClaims:['sub','iat','exp']});
 if(!protectedHeader.kid||payload.sub!==appId||payload.exp<=payload.iat)throw Error('Invalid App Check token');
 return true;
}
