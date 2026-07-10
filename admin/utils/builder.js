export function buildChapter(

number,

title,

date,

folder,

pages

){

return{

id:Number(number),

title,

createAt:
`${date}T00:00:00Z`,

folder,

pages

};

}