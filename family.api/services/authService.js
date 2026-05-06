
const { createHash } = require('crypto');



module.exports={
validateToken: (token) =>{
    try{
        return true;
    }
    catch(ex){
        return false;
    }
}
};