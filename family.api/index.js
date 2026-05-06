const express = require('express');
var cors = require('cors');
const authService = require('./services/authService');
const port = 3000;
const app = express();
const sqlite3 = require('sqlite3').verbose();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb' }));
// app.use(function(req, res, next) {
//     if(!validateToken(req.headers["profile"]) && !req.path.includes("auth/validate")){
//         res.status(401).send();
//     }
//     else{
//     next();
//     }
// });

// app.post('/auth/validate', (req, res) => {
//     if(!validateToken(req.headers["profile"]) ){
//         res.status(401).send();
//     }
//     else{
//         res.status(200).send("login success");
//     }
// });
function getFamily(familyGroupId = 1){
    return new Promise(async (resolve,reject)=>{
        const db = new sqlite3.Database('');
        try{
        db.serialize(() => {
            let family = [];
            db.all(`SELECT fm.*,  fg2.FamilyGroupId as SecondFamilyId,fg2.FamilyName as SecondFamilyName
                FROM FamilyMember fm 
                join familygroupassociation fga on fga.familymemberid=fm.familymemberid and fga.familygroupid=${familyGroupId}
                left join familygroupassociation fga2 on fga2.familymemberid=fm.familymemberid and fga2.familygroupid<>${familyGroupId}
                left join familygroup fg2 on fg2.familygroupid=fga2.familygroupid 
                `, (err, rows) => {
                resolve(rows);
            });
            
        });
        db.close();}
        catch(ex){
            db.close();
        }
    });
}
function getFamilyOptions(){
    return new Promise(async (resolve,reject)=>{
        const db = new sqlite3.Database('');
        try{
        db.serialize(() => {
            let family = [];
            db.all(`SELECT fg.*
                FROM FamilyGroup fg
                `, (err, rows) => {
                resolve(rows);
            });
            
        });
        db.close();}
        catch(ex){
            db.close();
        }
    });
}
app.get('/family', (req, res) => {
    try{
        getFamily(!isNaN(req.query.familyGroupId) && Number(req.query.familyGroupId)).then(family =>{res.json({
            FamilyMembers:family//,HeadMember:null
        });})
    

}
    catch(ex){
        //db.close();
        res.sendStatus(500);
    }
    
});
app.get('/family/options', (req, res) => {
    try{
        getFamilyOptions().then(families =>{res.json(families);})
    

}
    catch(ex){
        //db.close();
        res.sendStatus(500);
    }
    
});

app.listen(port, () => {
    console.log(`familyDb.API listening on port ${port}!`)
});
      