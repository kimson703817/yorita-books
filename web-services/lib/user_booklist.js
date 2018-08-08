/*
 * Provides API endpoints for working with book lists
 */
'use strict';
const rp = require('request-promise');

module.exports = (app, es) => {
   const userUrl = `http://${es.host}:${es.port}/${es.users_index}/user`;
   const bookUrl = `http://${es.host}:${es.port}/${es.books_index}/book`;
   const ReadStatus = Object.freeze({
      'READING': 'Reading',
      'FINISHED': 'Finished',
      'BACKLOG': 'BackLog',
      'ONHOLD': 'On-Hold',
      'DROPPED': 'Dropped'
   });
   /* default rejection handler for async functions 
   credit: https://strongloop.com/strongblog/async-error-handling-expressjs-es7-promises-generators/
   */
   let rejectHandler = fn => (...args) => fn(...args).catch(args[2]);


   /*
   *************************************************
      Application Middleware Definitions
   *************************************************
   */
   const getUserUrl = async(req, res, next) => {
      req.dbUrl.user = `${userUrl}/${req.params.id}`;
      req.dbOptions.user = {url: req.dbUrl.user, json: true};
      next();
   };

   const getBookUrl = async(req, res, next) => {
      req.dbUrl.book = `${bookUrl}/${req.params.pgid}`;
      req.dbOptions.book = {url: req.dbUrl.book, json: true};
      next();
   };

   const requestUserData = async(req, res, next) => {
      try {
         const userRes = await rp(req.dbOptions.user);
         req.dbResData.user = userRes._source;
         req.dbResData.version = userRes._version;
         Object.freeze(req.dbResData);
         next();
      } catch (dbResErr) {
         res.status(dbResErr.statusCode).json(dbResErr.error);
      };
   };

   const requestDbData = async(req, res, next) => {
      try {
         const [userRes, bookRes] = await Promise.all([
            rp(req.dbOptions.user),
            rp(req.dbOptions.book),
         ]);
         req.dbResData.user = userRes._source;
         req.dbResData.version = userRes._version;
         req.dbResData.book = bookRes._source;
         Object.freeze(req.dbResData);
         next();
      } catch (dbResErr) {
         res.status(dbResErr.statusCode).json(dbResErr.error);
      };
   };

   // get the book's read status from query
   // if empty, default is 'READING'
   const getReadStatus = async(req, res, next) => {
      if(req.query.status !== undefined) {
         let readStatus = ReadStatus[req.query.status.toUpperCase()];
         if(readStatus === undefined) {
            res.status(400).json('Invalid status!');
            return;
         }
         req.queryData = {readStatus};
      } else {
         req.queryData.readStatus = ReadStatus['READING'];
      };  
      Object.freeze(req.queryData.readStatus);
      next();
   }

   const getBookUpdateIndex = async(req, res, next) => {
      // retrieve the index of interest
      req.book_index = req.dbResData.user.books
         .findIndex(bookToAdd => bookToAdd.id === req.params.pgid);
      next();
   };
   
   /*
      * check to see if book is already in user's list
      * add to list if not found
      * otherwise throw error
   */
   const pushBooklistUpdate = async(req, res, next) => {
      if(req.book_index !== -1) {
         res.status(409).json('Book is already in the user\'s list.');
         return;
      }
      req.pendingUpdate = Object.freeze({
         id: req.params.pgid,
         title: req.dbResData.book.title,
         status: req.queryData.readStatus
      });
      req.dbResData.user.books.push(req.pendingUpdate);      
      next();
   }

   const pushReadStatusUpdate = async(req, res, next) => {
      if(req.book_index === -1) {
         res.status(404).json('Book is not in the user\'s list.');
         return;
      }
      if(req.dbResData.user.books[req.book_index].status
         === req.queryData.readStatus) {
         res.status(409).json('Read status already set to this value');
         return;
      }
      req.pendingUpdate = Object.freeze({
         id: req.params.pgid,
         title: req.dbResData.user.books[req.book_index].title,
         status: req.queryData.readStatus
      });
      req.dbResData.user.books.splice(req.book_index, 1, req.pendingUpdate);
      next();
   }

   const pushBookDelete = async(req, res, next) => {
      if(req.book_index === -1) {
         res.status(404).json('Book to be deleted is not in the user\'s list');
         return;
      }
      req.dbResData.user.books.splice(req.book_index, 1);
      next();
   }

   const updateUser = async(req, res, next) => {        
      try {
         const version = req.dbResData.version;
         const esResBody = await rp.put( {
            url: req.dbUrl.user,
            qs: { version },
            body: req.dbResData.user,
            json: true,
         });
         res.status(200).json(esResBody);
      } catch (esResErr) {
         res.status(esResErr.statusCode).json(esResErr.error);
      }
   }

   /*
   ***********************************************
      End of Application Middleware Definitions
   ***********************************************
   */

   /*
      * Initialize data objects
      * Initialize user url
   */
   app.use('/api/user/:id', async(req, res, next) => {
      req.dbUrl = {};
      req.dbOptions = {};
      req.dbResData = {};
      req.queryData = {};
      next();
   }, rejectHandler(getUserUrl));

   /*
      * Middleware stack for manipulating user's book list
   */
   app.use('/api/user/:id/book/:pgid',
      getBookUrl
   );

   /* 
      * Add book to the user's list
      * if the query string is empty, the default readStatus is 'READING'
      * Example: /api/user/yoshino703/books/pg703?status=reading
   */
   app.put('/api/user/:id/book/:pgid',
      rejectHandler(requestDbData),
      rejectHandler(getReadStatus),
      rejectHandler(getBookUpdateIndex),
      rejectHandler(pushBooklistUpdate),
      rejectHandler(updateUser)
   );

   /* 
      * Edit a book's read status
      * if the query string is empty, the default readStatus is 'READING'
      * Example: /api/user/yoshino703/book/pg1337?status=reading
   */
   app.put('/api/user/:id/bookstatus/:pgid',
      rejectHandler(requestUserData),
      rejectHandler(getReadStatus),
      rejectHandler(getBookUpdateIndex),
      rejectHandler(pushReadStatusUpdate),
      rejectHandler(updateUser)
   );

   /* 
      * Delete book from the user's list of books
      * Example: /api/user/yoshino703/books/pg703?status=reading
   */
   app.delete('/api/user/:id/book/:pgid',
      rejectHandler(requestUserData),
      rejectHandler(getBookUpdateIndex),
      rejectHandler(pushBookDelete),
      rejectHandler(updateUser)
   );
}