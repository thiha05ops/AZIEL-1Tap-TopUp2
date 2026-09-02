"use strict";
const categories=[
 {category_id:"mobile_legends_global",name:"Mobile Legends (Global)",note:"Region: Global\nNot available for Indonesia and BR regions.\nThe following packs are not available for MY/SG/PH/ID/RU regions: 78+8, Weekly Pass."},
 {category_id:"pubg_mobile_auto",name:"PUBG Mobile (Auto)",note:"Region: Global"},
 {category_id:"free_fire_th",name:"Free Fire (TH)",note:"Region: Thailand"},
 {category_id:"honor_of_kings",name:"Honor of Kings",note:"Enter Player ID."},
 {category_id:"valorant_th",name:"Valorant (TH)",note:"Region: Thailand"}
];
const offers={
 mobile_legends_global:[{offer_id:"42_diamonds",name:"42 Diamonds",price_usd:.7},{offer_id:"78_8_diamonds",name:"78 + 8 Diamonds",price_usd:1.1},{offer_id:"weekly_pass",name:"Weekly Pass",price_usd:1.4}],
 pubg_mobile_auto:[{offer_id:"60_uc",name:"60 UC",price_usd:.8},{offer_id:"60_wow_coins",name:"60 WOW Coins",price_usd:.9}],
 free_fire_th:[{offer_id:"33_diamonds",name:"33 Diamonds",price_usd:.3},{offer_id:"weekly_pack",name:"Weekly Pack",price_usd:2}],
 honor_of_kings:[{offer_id:"16_tokens",name:"16 Tokens",price_usd:.16},{offer_id:"double_token_lucky_bag",name:"Double Token Lucky Bag",price_usd:.2}],
 valorant_th:[{offer_id:"475_vp",name:"475 VP",price_usd:3.7}]
};
const fields={mobile_legends_global:[{key:"player_id",label:"Player ID"},{key:"server_id",label:"Server ID"}],pubg_mobile_auto:[{key:"player_id",label:"Player ID"}],free_fire_th:[{key:"player_id",label:"Player ID"}],honor_of_kings:[{key:"player_id",label:"Player ID"}],valorant_th:[{key:"riot_id",label:"Riot ID"}],future_game_global:[{key:"user_id",label:"Account ID"}]};
function reader({failCategory="",duplicate=false,repeatedCursor=false}={}){return{async listCategories(cursor=""){if(repeatedCursor)return{items:cursor?[]:categories.slice(0,2),meta:{next_cursor:"same"}};return cursor?{items:categories.slice(2),meta:{}}:{items:categories.slice(0,2),meta:{next_cursor:"page2"}};},async listOffers(id){if(id===failCategory)throw Object.assign(new Error("fixture timeout"),{code:"PROVIDER_TIMEOUT"});const rows=(offers[id]||[]).map(x=>({...x}));if(duplicate&&id==="mobile_legends_global")rows.push({...rows[0]});return{fields:(fields[id]||[]).map(x=>({...x})),offers:rows,meta:{revision:"fixture-r1"}};}};}
module.exports=Object.freeze({categories,offers,fields,reader});
