require('dotenv').load()

var os = require('os'),
    AWS = require('aws-sdk');

if (process.env.LOCAL) {
  require("babel-register")
  require("babel-polyfill")
}


AWS.config = new AWS.Config({
  region: process.env.AWS_REGION || 'us-east-1'
});


var lambda = new AWS.Lambda();
var swf = new AWS.SWF();


var config = {
   "domain": process.env.DOMAIN || "testdomain",
   "taskList": {"name": process.env.ACTIVITIES_TASKLIST || "lambda-activity-tasklist"},
   "identity": 'LambdaActivityPoller-' + os.hostname() + '-' + process.pid,
};

console.log(config)



var stop_poller = false;


var _ = {
  clone: function (src) {
    var tgt = {}, k;
    for (k in src) {
       if (src.hasOwnProperty(k)) {
          tgt[k] = src[k];
       }
    }
    return tgt;
  }
};


var poll = function () {


   // Copy config
   var o = _.clone(config);

   console.log("polling...");

   // Poll request on AWS
   // http://docs.aws.amazon.com/amazonswf/latest/apireference/API_PollForActivityTask.html
   swf.pollForActivityTask(o, function (err, result) {

      if (err) {
        console.log("Error in polling ! ", err);
        poll();
        return;
      }

      // If no new task, re-poll
      if (!result.taskToken) {
         poll();
         return;
      }

      _onNewTask(result);
      poll();
   });

};

function processActivityResult(taskToken, result) {
  var params = {
    taskToken: taskToken,
    result: JSON.stringify(result),
  }
  console.log('activity result', params)
  swf.respondActivityTaskCompleted(params, function(err, data) {
    if (err) console.log(err, err.stack); // an error occurred
    else     console.log('task completed', data);           // successful response
  })
}

var _onNewTask = function(task) {

  console.log(JSON.stringify(task, null, 3));

  var activity = task.activityType.name

  if (process.env.LOCAL) {
    console.log('Invoking local', activity)
    var lambda = require(process.env.LOCAL + '/' + activity + '/index.es6.js')
    ctx = {
      succeed: function(result) { processActivityResult(task.taskToken, result) },
      fail: function(result) { console.log('fail:', result) },
      done: function(result) { console.log('done:', result) }
    }
    lambda.handle(JSON.parse(task.input), ctx)
  } else {
    var params = {
      FunctionName: lambdaName,
      InvocationType: 'Event', // Do not wait for execution
      LogType: 'None',
      Payload: JSON.stringify({
        input: lambdaParams,
        taskToken: taskToken
      })
    };
    console.log('Invoking lambda', params);
    lambda.invoke(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    });
  }
};


poll();